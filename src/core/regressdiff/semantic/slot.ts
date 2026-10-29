import { canonical } from '../canonical.ts';
import { sha256 } from '../hash.ts';
import { NORMALISATION_VERSION } from '../normalise.ts';
import type { Sample, TaskPair } from '../pairing.ts';
import { createPointer, sampleFieldView, type EvidencePointer } from '../pointers.ts';
import { diffField, type FieldDiff } from '../diff.ts';
import { spanEvidence } from '../evidence.ts';
import { resolvePointer } from '../resolver.ts';
import type { RulingEvent } from '../rulings.ts';
import { FACT_BASELINE_VERSION, REFUSAL_BASELINE_VERSION, observeFacts, observeRefusal, type FactObservation, type RefusalStyle } from './baselines.ts';

export interface SemanticObservation extends FactObservation { sample: number; available: boolean; refusal_style: RefusalStyle }
export interface SemanticReview {
  id: string; task_id: string; baseline: 'key-token-facts' | 'refusal-style'; baseline_version: string;
  verdict: 'NEEDS_REVIEW'; detail: string; required_facts: string[]; expected_refusal: 'answered' | 'refused' | null;
  observations: { old: SemanticObservation[]; new: SemanticObservation[] };
  pointers: { old: EvidencePointer[]; new: EvidencePointer[] }; support: 'supported' | 'unsupported'; support_reasons: string[];
  diffs: FieldDiff[]; diff_sample: number;
  current_ruling: RulingEvent | null;
}
export const SEMANTIC_SLOT_VERSION = 'semantic-slot-v1';
export const semanticPending = (item: Pick<SemanticReview, 'current_ruling'>): boolean => !['confirmed', 'waived'].includes(item.current_ruling?.kind ?? '');
function observation(sample: Sample, facts: readonly string[]): SemanticObservation {
  return { sample: sample.sample, available: sample.output !== null,
    ...(sample.output ? observeFacts(facts, sample.output.text) : { fact_kept: null, missing_facts: [], unjudgeable_facts: [...facts] }),
    refusal_style: sample.output ? observeRefusal(sample.output.text, sample.output.stop_reason) : 'unknown' };
}
/** Only task metadata and already validated sample pairs enter. There is deliberately no cell/adapter/report input. */
export function semanticReviews(pairs: readonly TaskPair[]): SemanticReview[] {
  const items: SemanticReview[] = [];
  for (const pair of pairs) {
    if (pair.task.category !== 'semantic' && pair.task.category !== 'refusal') continue;
    const facts = pair.task.required_facts ?? [];
    const expectedValues = [...new Set(pair.task.checks.filter((check) => check.type === 'refusal').map((check) =>
      (check.params as { expected: 'answered' | 'refused' }).expected))];
    const expected_refusal = expectedValues.length === 1 ? expectedValues[0] : null;
    const observations = { old: pair.samples.map(({ old }) => observation(old, facts)), new: pair.samples.map(({ new: next }) => observation(next, facts)) };
    const factConcern = observations.new.some((item) => item.missing_facts.length > 0 || item.unjudgeable_facts.length > 0);
    const hasRefusalConcern = (item: SemanticObservation, index: number): boolean => item.available && (item.refusal_style === 'unknown' ||
      (expected_refusal !== null ? item.refusal_style !== expected_refusal : item.refusal_style === 'refused' ||
        (observations.old[index].refusal_style !== 'unknown' && item.refusal_style !== observations.old[index].refusal_style)));
    const refusalConcern = observations.new.some(hasRefusalConcern);
    for (const baseline of ['key-token-facts', 'refusal-style'] as const) {
      if (baseline === 'key-token-facts' ? !facts.length || !factConcern : !refusalConcern) continue;
      const baseline_version = baseline === 'key-token-facts' ? FACT_BASELINE_VERSION : REFUSAL_BASELINE_VERSION;
      const index = Math.max(0, observations.new.findIndex((item, at) => baseline === 'key-token-facts'
        ? item.missing_facts.length > 0 || item.unjudgeable_facts.length > 0
        : hasRefusalConcern(item, at)));
      const representative = pair.samples[index];
      const fields = baseline === 'refusal-style' ? ['text', 'stop_reason'] as const : ['text'] as const;
      const diffs = fields.map((field) => diffField(field, sampleFieldView(representative.old, field), sampleFieldView(representative.new, field)));
      const samples = pair.samples.flatMap(({ old, new: next }) => [old, next]);
      const pointer = (sample: Sample): EvidencePointer => createPointer(sample, sample.output
        ? spanEvidence(sample.output, baseline === 'refusal-style' && sample.output.stop_reason === 'refusal' ? 'stop_reason' : 'text')
        : { field: 'text', anchor: 0, context: '' });
      const pointers = { old: pair.samples.map(({ old }) => pointer(old)), new: pair.samples.map(({ new: next }) => pointer(next)) };
      const support_reasons = [...pointers.old, ...pointers.new].flatMap((item) => {
        const resolution = resolvePointer(item, samples);
        return resolution.status === 'unsupported' ? [`${item.pointer}: ${resolution.reason}`] : [];
      });
      const id = sha256(canonical({ task_id: pair.task.id, category: pair.task.category, required_facts: facts, expected_refusal,
        baseline, baseline_version, slot_version: SEMANTIC_SLOT_VERSION, normalisation_version: NORMALISATION_VERSION,
        old_output_hashes: pair.samples.map(({ old }) => old.output_sha256), new_output_hashes: pair.samples.map(({ new: next }) => next.output_sha256) }));
      items.push({ id, task_id: pair.task.id, baseline, baseline_version, verdict: 'NEEDS_REVIEW', required_facts: [...facts], expected_refusal,
        detail: baseline === 'key-token-facts' ? 'New-side required-fact key tokens are missing or unjudgeable; lexical presence is not entailment.'
          : 'New-side refusal style differs from the declared expectation, changes style, or is inconclusive under the versioned phrase/stop-reason baseline.',
        observations, pointers, diffs, diff_sample: representative.new.sample,
        support: support_reasons.length ? 'unsupported' : 'supported', support_reasons, current_ruling: null });
    }
  }
  return items;
}
