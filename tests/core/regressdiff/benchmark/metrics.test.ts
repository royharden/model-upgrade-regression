import { describe, expect, it } from 'vitest';
import { calculateMetrics, proposalLines, renderResults, type BenchmarkReport } from '../../../../src/core/regressdiff/benchmark/metrics.ts';
import { classSupport, renderSupport, type BenchmarkSupport } from '../../../../src/core/regressdiff/benchmark/support.ts';
import type { MethodResult } from '../../../../src/core/regressdiff/benchmark/methods.ts';

const inventory: BenchmarkSupport[] = [
  { kind: 'planted', class_name: 'thinking_leak', dev: 2, heldout: 2, dev_tasks: 1, heldout_tasks: 1 },
  { kind: 'planted', class_name: 'lost_fact', dev: 0, heldout: 0, dev_tasks: 0, heldout_tasks: 0 },
  { kind: 'control', class_name: 'already_failing_old', dev: 1, heldout: 1, dev_tasks: 1, heldout_tasks: 1 },
];
function result(overrides: Partial<MethodResult> = {}): MethodResult {
  return { variant_id: 'plant.one', task_id: 'task.one', class_name: 'thinking_leak', partition: 'dev', kind: 'planted', method: 'paired_checker', k: 5,
    flagged: true, attributed: true, flagged_check_ids: ['check'], could_not_judge: 0, pointer_integrity: { total: 10, supported: 10, applicable: true }, findings: [], ...overrides };
}
describe('benchmark metrics retain denominators and complete failure lists', () => {
  it('reports raw versus attributed recall, descriptive Wilson counts and named failures', () => {
    const rows = [result(), result({ variant_id: 'plant.two', task_id: 'task.two', flagged: false, attributed: false, could_not_judge: 1 }),
      result({ variant_id: 'control.one', kind: 'control', class_name: 'already_failing_old' }),
      result({ variant_id: 'improvement.one', kind: 'improvement', class_name: 'thinking_leak' })];
    const metrics = calculateMetrics(rows, inventory).find((item) => item.method === 'paired_checker' && item.k === 5)!;
    expect(metrics.classes[0].raw_recall).toMatchObject({ numerator: 1, denominator: 2, status: 'evaluated', interval: { successes: 1, n: 2 } });
    expect(metrics.classes[0].raw_recall.interval!.lower).toBeCloseTo(0.09453, 4);
    expect(metrics.classes[0].raw_recall.interval!.upper).toBeCloseTo(0.90547, 4);
    expect(metrics.classes[1].raw_recall).toMatchObject({ numerator: 0, denominator: 0, interval: null, status: 'not evaluated' });
    expect(metrics.false_alarms[0]).toMatchObject({ class_name: 'already_failing_old', rate: { numerator: 1, denominator: 1 }, flagged_variant_ids: ['control.one'] });
    expect(metrics.improvements_flagged).toMatchObject({ numerator: 1, denominator: 1 });
    expect(metrics.could_not_judge).toBe(1);
    expect(metrics.failures).toEqual([
      { variant_id: 'plant.two', task_id: 'task.two', class_name: 'thinking_leak', method: 'paired_checker', k: 5, reason: 'missed_plant' },
      { variant_id: 'control.one', task_id: 'task.one', class_name: 'already_failing_old', method: 'paired_checker', k: 5, reason: 'spurious_control' },
      { variant_id: 'improvement.one', task_id: 'task.one', class_name: 'thinking_leak', method: 'paired_checker', k: 5, reason: 'spurious_improvement' },
    ]);
  });
  it('exact diff attribution and pointer integrity are N/A rather than zero-percent scores', () => {
    const metrics = calculateMetrics([result({ method: 'exact_normalised_diff', attributed: null, pointer_integrity: { supported: 0, total: 0, applicable: false } })], inventory)
      .find((item) => item.method === 'exact_normalised_diff' && item.k === 5)!;
    expect(metrics.classes[0].attributed_recall).toMatchObject({ status: 'N/A', interval: null, numerator: null, denominator: null });
    expect(metrics.pointer_integrity.status).toBe('N/A');
  });
  it('support inventory contains absent classes and renders them before metric headings', () => {
    const support = classSupport([]);
    expect(support.filter((row) => row.kind === 'planted')).toHaveLength(10);
    expect(support.filter((row) => row.kind === 'control')).toHaveLength(7);
    expect(renderSupport(support, 'heldout')).toContain('not evaluated');
    const metrics = calculateMetrics([], support);
    const report: BenchmarkReport = { schema_version: 'benchmark-results-v1', partition: 'heldout', benchmark_version: 'test', config_sha256: 'hash', measured_at: 'test', caveat: 'Synthetic',
      support, metrics, proposals: proposalLines(metrics, 'heldout'), excluded_source_errors: [], semantic: { key_token: 'pending M6', refusal_style: 'pending M6', generative_judge: 'not evaluated', jev: 'not evaluated' } };
    const markdown = renderResults(report);
    expect(markdown.indexOf('## Class support')).toBeLessThan(markdown.indexOf('## Metrics'));
    expect(markdown).toContain('clustered by base task');
    expect(report.proposals.join('\n')).toContain('not evaluated (no held-out support)');
    expect(report.proposals.join('\n')).not.toContain('proposed threshold met');
  });
  it('does not claim superiority when raw recall differs', () => {
    const metrics = calculateMetrics([result(), result({ method: 'model_matrix', flagged: false, attributed: false })], inventory);
    expect(proposalLines(metrics, 'heldout').join('\n')).toContain('observed raw recall differs');
    expect(proposalLines(metrics, 'dev').join('\n')).toContain('held-out acceptance not evaluated');
  });
  it('raw detection can succeed while the target check attribution misses', () => {
    const metrics = calculateMetrics([result({ attributed: false })], inventory).find((item) => item.method === 'paired_checker' && item.k === 5)!;
    expect(metrics.classes[0].raw_recall.numerator).toBe(1);
    expect(metrics.classes[0].attributed_recall.numerator).toBe(0);
    expect(metrics.failures[0].reason).toBe('missed_attribution');
  });
});
