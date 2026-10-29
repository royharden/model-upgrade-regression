import { describe, expect, it } from 'vitest';
import { SuiteSchema } from '../../../../src/core/regressdiff/schema/suite.ts';
import type { RecordingLine } from '../../../../src/core/regressdiff/schema/output.ts';
import type { Variant } from '../../../../src/core/regressdiff/benchmark/types.ts';
import { METHOD_IDS, runMethod, runMethods } from '../../../../src/core/regressdiff/benchmark/methods.ts';

function variant(oldTexts: string[], newTexts: string[]): Variant {
  const suite = SuiteSchema.parse({ id: 'method-contract', name: 'Method contract', tasks: [{ id: 'method.task', category: 'constraint',
    messages: [{ role: 'user', content: 'Answer OK' }], tools: [], independent_tool_calls: false,
    checks: [{ id: 'answer', type: 'equals', params: { value: 'OK', field: 'text' } }] }] });
  const lines = (texts: string[]): RecordingLine[] => texts.map((text, index) => ({ task_id: 'method.task', sample: index + 1,
    output: { text, thinking: '', tool_calls: [], tool_calls_original: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, latency_ms: 1 } }));
  const old = lines(oldTexts), next = lines(newTexts);
  return { id: 'plant.length_bound_passed.test', task_id: 'method.task', partition: 'dev', kind: 'planted', class_name: 'length_bound_passed',
    expected_check_type: 'equals', expected_check_id: 'answer', expected_miss_reason: null, suite, old, new: next, raw_old: old, raw_new: next };
}
const same = (value: string): string[] => Array.from({ length: 5 }, () => value);
describe('benchmark methods share the production core with declared ablations', () => {
  it('runs exactly five methods at k=1 and k=5 on identical source rows', () => {
    const results = runMethods([variant(same('OK'), same('bad'))]);
    expect(results).toHaveLength(10);
    for (const k of [1, 5] as const) for (const method of METHOD_IDS) {
      expect(results.find((row) => row.k === k && row.method === method)).toMatchObject({ flagged: true });
    }
    expect(results.find((row) => row.method === 'exact_normalised_diff')!.attributed).toBeNull();
    expect(results.filter((row) => row.method !== 'exact_normalised_diff').every((row) => row.attributed)).toBe(true);
  });
  it('matrix flags new failures on pre-existing controls while paired checker does not', () => {
    const row = { ...variant(same('bad'), same('bad')), kind: 'control' as const, class_name: 'already_failing_old' as const };
    expect(runMethod(row, 'model_matrix', 5).flagged).toBe(true);
    expect(runMethod(row, 'model_matrix', 5).findings[0].verdict).toBe('PRE_EXISTING');
    expect(runMethod(row, 'paired_checker', 5).flagged).toBe(false);
    expect(runMethod(row, 'no_noise_floor', 5).flagged).toBe(false);
  });
  it('normalisation is shared by exact diff and checker; only no-normalisation sees a trailing newline failure', () => {
    const row = variant(same('OK'), same('OK\r\n'));
    expect(runMethod(row, 'exact_normalised_diff', 5).flagged).toBe(false);
    expect(runMethod(row, 'paired_checker', 5).flagged).toBe(false);
    expect(runMethod(row, 'no_normalisation', 5)).toMatchObject({ flagged: true, attributed: true });
  });
  it('removes the floor for a 5/5 to 4/5 decrease without changing k=1 or the majority rule', () => {
    const row = variant(same('OK'), ['OK', 'OK', 'OK', 'OK', 'bad']);
    expect(runMethod(row, 'paired_checker', 5).flagged).toBe(false);
    expect(runMethod(row, 'no_noise_floor', 5).flagged).toBe(true);
    expect(runMethod(row, 'no_noise_floor', 1).flagged).toBe(false);
    const majority = variant(['OK', 'OK', 'OK', 'bad', 'bad'], ['OK', 'OK', 'bad', 'bad', 'bad']);
    expect(runMethod(majority, 'paired_checker', 5).flagged).toBe(true);
    expect(runMethod(majority, 'no_noise_floor', 5).flagged).toBe(true);
    expect(runMethod(variant(['OK', 'OK', 'OK', 'OK', 'bad'], same('OK')), 'no_noise_floor', 5).flagged).toBe(false);
    expect(runMethod(variant(['OK', 'OK', 'OK', 'OK', 'bad'], same('OK')), 'no_noise_floor', 5).findings[0].verdict).toBe('IMPROVED');
  });
  it('retains could-not-judge precedence and never turns an error into a regression', () => {
    const row = variant(same('OK'), same('bad'));
    row.old[1] = { task_id: row.task_id, sample: 2, output: null, error: 'fixture-error' };
    row.raw_old = row.old;
    for (const method of ['paired_checker', 'no_noise_floor', 'no_normalisation'] as const) {
      expect(runMethod(row, method, 5)).toMatchObject({ flagged: false, could_not_judge: 1 });
    }
  });
  it('check-attributed detection requires the declared target, even when another check flags', () => {
    const row = variant(same('OK'), same('bad'));
    row.expected_check_id = 'different-target';
    expect(runMethod(row, 'paired_checker', 5)).toMatchObject({ flagged: true, attributed: false });
  });
});
