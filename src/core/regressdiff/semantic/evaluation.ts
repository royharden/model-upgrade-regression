import { z } from 'zod';
import { FACT_BASELINE_VERSION, FACT_STOP_WORDS, REFUSAL_BASELINE_VERSION, observeFacts, observeRefusal } from './baselines.ts';
import { REFUSAL_PHRASES } from '../checks/refusal.ts';
import { KNOWN_STOP_REASONS } from '../schema/output.ts';
import { wilsonInterval, type WilsonInterval } from '../stats/wilson.ts';
import { DISABLED_SEMANTIC_ADAPTERS } from './adapters.ts';
import { SEMANTIC_SLOT_VERSION } from './slot.ts';

export const SEMANTIC_FIXTURE_VERSION = 'semantic-synthetic-v1';
export const SemanticFixtureSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/), split: z.enum(['dev', 'heldout']),
  required_facts: z.array(z.string().min(1)).min(1), text: z.string(), stop_reason: z.enum(KNOWN_STOP_REASONS).nullable(),
  labels: z.object({ fact_kept: z.boolean(), refusal_style: z.enum(['answered', 'refused']) }).strict(),
}).strict();
export type SemanticFixture = z.infer<typeof SemanticFixtureSchema>;
export interface SemanticClassMetrics {
  label: string; actual_support: number; predicted_support: number; tp: number; fp: number; fn: number; tn: number;
  abstentions: number; precision: WilsonInterval | null; recall: WilsonInterval | null; f1: number | null;
}
export interface SemanticEvaluationRow {
  id: 'key-token-facts' | 'refusal-style' | 'generative-judge' | 'jev'; label: string;
  status: 'evaluated' | 'not evaluated'; metric: 'fact F1' | 'refusal macro-F1' | null; value: number | null;
  total: number; n: number; abstentions: number; classes: SemanticClassMetrics[]; notes: string[];
}
/** Hash this canonical configuration alongside fixture bytes in the evaluation CLI. No model adapter runs. */
export function semanticEvaluationConfig() {
  return { fixture_version: SEMANTIC_FIXTURE_VERSION, slot_version: SEMANTIC_SLOT_VERSION,
    facts: { id: 'key-token-facts', version: FACT_BASELINE_VERSION, stop_words: [...FACT_STOP_WORDS], tokenizer: 'Unicode letter/number tokens; lowercase; unique; all tokens required' },
    refusal: { id: 'refusal-style', version: REFUSAL_BASELINE_VERSION, phrases: [...REFUSAL_PHRASES], known_stop_reasons: [...KNOWN_STOP_REASONS] },
    metrics_version: 'semantic-metrics-v1', abstention_policy: 'Abstentions count as false negatives for their actual class; never predicted positives. Unknown/no support stays null.',
    adapters: DISABLED_SEMANTIC_ADAPTERS.map((adapter) => ({ ...adapter })) };
}
function classMetrics(label: string, actual: readonly string[], predictions: readonly (string | null)[]): SemanticClassMetrics {
  let tp = 0, fp = 0, fn = 0, tn = 0, abstentions = 0;
  actual.forEach((value, index) => {
    const prediction = predictions[index];
    if (prediction === null) { abstentions++; if (value === label) fn++; return; }
    if (value === label) { if (prediction === label) tp++; else fn++; }
    else if (prediction === label) fp++; else tn++;
  });
  return { label, actual_support: actual.filter((value) => value === label).length, predicted_support: predictions.filter((value) => value === label).length,
    tp, fp, fn, tn, abstentions, precision: wilsonInterval(tp, tp + fp), recall: wilsonInterval(tp, tp + fn),
    f1: 2 * tp + fp + fn === 0 ? null : 2 * tp / (2 * tp + fp + fn) };
}
/** Pure labelled-fixture evaluation, separate from the deterministic benchmark and comparison cells. */
export function evaluateSemanticFixtures(input: readonly unknown[]): SemanticEvaluationRow[] {
  const rows = input.map((row) => SemanticFixtureSchema.parse(row));
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Duplicate semantic fixture id');
  if (new Set(rows.map((row) => row.split)).size > 1) throw new Error('Semantic evaluation must use one split at a time');
  const facts = rows.map((row) => observeFacts(row.required_facts, row.text).fact_kept);
  const styles = rows.map((row) => observeRefusal(row.text, row.stop_reason));
  const factClass = classMetrics('kept', rows.map((row) => row.labels.fact_kept ? 'kept' : 'lost'), facts.map((value) => value === null ? null : value ? 'kept' : 'lost'));
  const refusalClasses = (['answered', 'refused'] as const).map((label) => classMetrics(label, rows.map((row) => row.labels.refusal_style), styles.map((value) => value === 'unknown' ? null : value)));
  const factAbstentions = facts.filter((value) => value === null).length, refusalAbstentions = styles.filter((value) => value === 'unknown').length;
  const notes = ['Synthetic labelled responses; descriptive Wilson 95% precision/recall intervals, not domain validation.',
    'Key-token containment is lexical and misses negation/relationships/synonyms; phrase matching misses hedged refusals and quoted phrases.',
    'Abstentions count as false negatives for their actual class. Zero denominators are unavailable, never perfect.'];
  return [
    { id: 'key-token-facts', label: FACT_BASELINE_VERSION, status: 'evaluated', metric: 'fact F1', value: factClass.f1,
      total: rows.length, n: rows.length - factAbstentions, abstentions: factAbstentions, classes: [factClass], notes: [...notes] },
    { id: 'refusal-style', label: REFUSAL_BASELINE_VERSION, status: 'evaluated', metric: 'refusal macro-F1',
      value: refusalClasses.every((item) => item.f1 !== null) ? refusalClasses.reduce((sum, item) => sum + (item.f1 ?? 0), 0) / refusalClasses.length : null,
      total: rows.length, n: rows.length - refusalAbstentions, abstentions: refusalAbstentions, classes: refusalClasses, notes: [...notes] },
    ...DISABLED_SEMANTIC_ADAPTERS.map((adapter): SemanticEvaluationRow => ({ id: adapter.id, label: adapter.model ?? adapter.id,
      status: 'not evaluated', metric: null, value: null, total: rows.length, n: 0, abstentions: 0, classes: [],
      notes: ['Disabled typed interface only; execution unimplemented; live documentation and validation deferred.'] })),
  ];
}
