import { wilsonInterval, type WilsonInterval } from '../stats/wilson.ts';
import { METHOD_IDS, type BenchmarkK, type MethodId, type MethodResult } from './methods.ts';
import { renderSupport, type BenchmarkSupport } from './support.ts';
import type { Variant } from './types.ts';
import type { SemanticEvaluationRow } from '../semantic/evaluation.ts';

export interface Rate { numerator: number; denominator: number; interval: WilsonInterval | null; status: 'evaluated' | 'not evaluated' }
export interface NotApplicableRate { numerator: null; denominator: null; interval: null; status: 'N/A' }
export interface ClassMetric { class_name: string; raw_recall: Rate; attributed_recall: Rate | NotApplicableRate }
export interface FailurePair { variant_id: string; task_id: string; class_name: string; method: MethodId; k: BenchmarkK; reason: 'missed_plant' | 'missed_attribution' | 'spurious_control' | 'spurious_improvement' }
export interface MethodMetrics {
  method: MethodId; k: BenchmarkK; classes: ClassMetric[];
  false_alarms: { class_name: string; rate: Rate; flagged_variant_ids: string[] }[];
  improvements_flagged: Rate; could_not_judge: number;
  pointer_integrity: { supported: number; total: number; status: 'evaluated' | 'not evaluated' | 'N/A' };
  failures: FailurePair[];
}
export interface BenchmarkReport {
  schema_version: 'benchmark-results-v1'; partition: Variant['partition']; benchmark_version: string; config_sha256: string; measured_at: string;
  caveat: string; support: BenchmarkSupport[]; metrics: MethodMetrics[]; proposals: string[];
  excluded_source_errors: { task_id: string; error_samples: number[]; accounting: 'COULD_NOT_JUDGE'; reason: string }[];
  semantic: { key_token: string; refusal_style: string; generative_judge: string; jev: string };
  semantic_evaluation?: SemanticEvaluationRow[];
  semantic_fixture_sha256?: { dev: string; heldout: string };
  semantic_configuration?: ReturnType<typeof import('../semantic/evaluation.ts').semanticEvaluationConfig>;
}
const rate = (numerator: number, denominator: number): Rate => ({ numerator, denominator,
  interval: wilsonInterval(numerator, denominator), status: denominator ? 'evaluated' : 'not evaluated' });

export function calculateMetrics(results: readonly MethodResult[], inventory: readonly BenchmarkSupport[]): MethodMetrics[] {
  return ([1, 5] as const).flatMap((k) => METHOD_IDS.map((method) => {
    const rows = results.filter((row) => row.k === k && row.method === method);
    const classes = inventory.filter((item) => item.kind === 'planted').map((item) => {
      const plants = rows.filter((row) => row.kind === 'planted' && row.class_name === item.class_name);
      return { class_name: item.class_name, raw_recall: rate(plants.filter((row) => row.flagged).length, plants.length),
        attributed_recall: method === 'exact_normalised_diff' ? { numerator: null, denominator: null, interval: null, status: 'N/A' as const }
          : rate(plants.filter((row) => row.attributed === true).length, plants.length) };
    });
    const false_alarms = inventory.filter((item) => item.kind === 'control').map((item) => {
      const controls = rows.filter((row) => row.kind === 'control' && row.class_name === item.class_name);
      return { class_name: item.class_name, rate: rate(controls.filter((row) => row.flagged).length, controls.length),
        flagged_variant_ids: controls.filter((row) => row.flagged).map((row) => row.variant_id) };
    });
    const improvements = rows.filter((row) => row.kind === 'improvement');
    const supported = rows.reduce((sum, row) => sum + row.pointer_integrity.supported, 0), total = rows.reduce((sum, row) => sum + row.pointer_integrity.total, 0);
    const failures: FailurePair[] = rows.flatMap((row) => row.kind === 'planted' && (!row.flagged || row.attributed === false) || row.kind !== 'planted' && row.flagged
      ? [{ variant_id: row.variant_id, task_id: row.task_id, class_name: row.class_name, method, k,
        reason: row.kind === 'planted' ? row.flagged ? 'missed_attribution' as const : 'missed_plant' as const : row.kind === 'control' ? 'spurious_control' as const : 'spurious_improvement' as const }] : []);
    return { method, k, classes, false_alarms, improvements_flagged: rate(improvements.filter((row) => row.flagged).length, improvements.length),
      could_not_judge: rows.reduce((sum, row) => sum + row.could_not_judge, 0), pointer_integrity: {
        supported, total, status: method === 'exact_normalised_diff' ? 'N/A' as const : total ? 'evaluated' as const : 'not evaluated' as const }, failures };
  }));
}

export function proposalLines(metrics: readonly MethodMetrics[], partition: Variant['partition']): string[] {
  const proposals = ['Proposed acceptance: paired checker held-out raw recall >= 0.9 per deterministic class, with n shown; no unlisted false alarms.',
    'Author-built planted variants measure wiring and false-alarm discipline, not real-world model drift.',
    'Named expected misses: lost fact, tone shift, subtly wrong number. Live ledger cost: not evaluated (recorded synthetic benchmark).'];
  for (const k of [1, 5] as const) {
    const checker = metrics.find((row) => row.method === 'paired_checker' && row.k === k);
    if (!checker) continue;
    for (const item of checker.classes) proposals.push(`k=${k} ${item.class_name}: ${partition !== 'heldout' ? 'development only; held-out acceptance not evaluated' : item.raw_recall.status !== 'evaluated' ? 'not evaluated (no held-out support)' : item.class_name === 'lost_fact' ? 'semantic expected miss; deterministic threshold N/A' : `${item.raw_recall.numerator}/${item.raw_recall.denominator}; proposed threshold ${item.raw_recall.numerator / item.raw_recall.denominator >= 0.9 ? 'met' : 'not met'}`}.`);
    for (const baseline of ['exact_normalised_diff', 'model_matrix'] as const) {
      const other = metrics.find((row) => row.method === baseline && row.k === k);
      const matched = !!other && checker.classes.every((item, index) => item.raw_recall.denominator === other.classes[index]?.raw_recall.denominator && item.raw_recall.numerator === other.classes[index]?.raw_recall.numerator);
      const alarms = (item: MethodMetrics) => item.false_alarms.reduce((sum, row) => sum + row.rate.numerator, 0) + item.improvements_flagged.numerator;
      proposals.push(`k=${k} paired_checker versus ${baseline}: ${!matched ? 'observed raw recall differs; report the recall/false-alarm trade-off, no superiority claim' : !checker.classes.some((item) => item.raw_recall.denominator > 0) ? 'not evaluated' : `matched observed per-class raw recall; spurious flags ${alarms(checker)} versus ${alarms(other!)}; ${alarms(checker) < alarms(other!) ? 'fewer observed spurious flags' : 'no observed false-alarm advantage'}`}.`);
    }
  }
  return proposals;
}
function display(value: Rate | NotApplicableRate): string {
  if (value.status !== 'evaluated') return value.status;
  return `${value.numerator}/${value.denominator} (${(100 * value.numerator / value.denominator).toFixed(1)}%; Wilson 95% ${value.interval!.lower.toFixed(3)}–${value.interval!.upper.toFixed(3)})`;
}
export function renderResults(report: BenchmarkReport): string {
  const lines = ['# Benchmark results', '', `Partition: ${report.partition}; benchmark: ${report.benchmark_version}; config: ${report.config_sha256}; measured: ${report.measured_at}.`, '', report.caveat, '',
    renderSupport(report.support, report.partition), '## Source recorded-error exclusions', '',
    ...report.excluded_source_errors.map((item) => `- ${item.task_id}: ${item.accounting}; source error samples ${item.error_samples.join(', ')}; ${item.reason}`), '',
    'These source tasks are excluded from all generated variant denominators, retained in the manifest hash, and accounted separately from method COULD_NOT_JUDGE cells below.', '',
    '## Metrics', '', 'All intervals are descriptive Wilson 95%; variants are clustered by base task and are not independent trials.', ''];
  for (const row of report.metrics) {
    lines.push(`### ${row.method}, k=${row.k}`, '', '| Planted class | Raw recall | Check-attributed recall |', '| --- | --- | --- |',
      ...row.classes.map((item) => `| ${item.class_name} | ${display(item.raw_recall)} | ${display(item.attributed_recall)} |`), '',
      '| Named control | False alarms | Flagged variant IDs |', '| --- | --- | --- |', ...row.false_alarms.map((item) => `| ${item.class_name} | ${display(item.rate)} | ${item.flagged_variant_ids.join(', ') || 'none'} |`), '',
      `Improvements flagged as regressions: ${display(row.improvements_flagged)}. COULD_NOT_JUDGE cells: ${row.could_not_judge}.`,
      `Pointer integrity (diagnostic, not headline): ${row.pointer_integrity.status === 'evaluated' ? `${row.pointer_integrity.supported}/${row.pointer_integrity.total} supported` : row.pointer_integrity.status}.`, '');
  }
  lines.push('## Every missed or spurious pair', '', '| Reason | Variant | Task | Class | Method | k |', '| --- | --- | --- | --- | --- | --- |',
    ...report.metrics.flatMap((row) => row.failures).map((item) => `| ${item.reason} | ${item.variant_id} | ${item.task_id} | ${item.class_name} | ${item.method} | ${item.k} |`), '',
    '## Proposed acceptance and trade-offs', '', ...report.proposals.map((line) => `- ${line}`), '', '## Semantic slot', '',
    `Key-token baseline: ${report.semantic.key_token}. Refusal-style baseline: ${report.semantic.refusal_style}. Generative judge: ${report.semantic.generative_judge}. Jev: ${report.semantic.jev}.`, '');
  if (report.semantic_fixture_sha256) lines.push(`Semantic fixture SHA-256: dev ${report.semantic_fixture_sha256.dev}; heldout ${report.semantic_fixture_sha256.heldout}.`, '');
  for (const row of report.semantic_evaluation ?? []) {
    lines.push(`### ${row.label}`, '', `Status: ${row.status}; ${row.metric ?? 'no metric'}: ${row.value === null ? 'not evaluated' : row.value.toFixed(4)}. Judged ${row.n}/${row.total}; abstentions ${row.abstentions}.`, '',
      ...row.notes.map((note) => `- ${note}`), '');
    if (row.status === 'evaluated') {
      const interval = (value: WilsonInterval | null): string => value === null ? 'not evaluated' : `${value.successes}/${value.n} (Wilson 95% ${value.lower.toFixed(3)}–${value.upper.toFixed(3)})`;
      lines.push('| Class | Actual support | Predicted support | TP / FP / FN / TN | Abstentions | Precision | Recall | F1 |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...row.classes.map((item) => `| ${item.label} | ${item.actual_support} | ${item.predicted_support} | ${item.tp} / ${item.fp} / ${item.fn} / ${item.tn} | ${item.abstentions} | ${interval(item.precision)} | ${interval(item.recall)} | ${item.f1 === null ? 'not evaluated' : item.f1.toFixed(4)} |`), '');
    }
  }
  return lines.join('\n');
}
