import { describe, expect, it } from 'vitest';
import { calculateSuiteStatistics } from '../../../src/core/regressdiff/stats/index.ts';
import type { Suite } from '../../../src/core/regressdiff/schema/suite.ts';
import type { RunManifest } from '../../../src/core/regressdiff/schema/manifest.ts';
import type { NormalisedOutput } from '../../../src/core/regressdiff/schema/output.ts';
import type { Cell } from '../../../src/core/regressdiff/findings.ts';
import type { Sample } from '../../../src/core/regressdiff/pairing.ts';
import type { CheckStatus } from '../../../src/core/regressdiff/evidence.ts';
import { cellVerdict } from '../../../src/core/regressdiff/verdict.ts';

function fixture() {
  const model = { id: 'mock:old', provider: 'mock' as const,
    prices: null, check_prices: { currency: 'USD' as const, input_per_mtok: 1_000_000, output_per_mtok: 4,
      verified_date: null, synthetic: true }, max_tokens: 1000, reasoning_budget: 0,
    billing: { reasoning_counts_in_max_tokens: true }, per_message_overhead_bound: 0,
    sampling_params_supported: [], supports_tools: true };
  const manifest: RunManifest = { run_id: 'r', suite_sha256: 'a'.repeat(64), models_config_sha256: 'b'.repeat(64), k: 3,
    mode: 'demo', old_model: model, new_model: { ...model, id: 'mock:new' },
    normalisation_version: 'v1', canonical_version: 'v1', verdict_rule_version: 'v1', seed: 40 };
  const suite: Suite = { id: 's', name: 'Task-weighted statistics', tasks: Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`, category: 'constraint', messages: [{ role: 'user', content: 'Reply' }], tools: [], independent_tool_calls: false,
    checks: [{ id: 'a', type: 'contains', params: { value: 'x' } }, { id: 'b', type: 'contains', params: { value: 'y' } }],
  })) };
  const cells: Cell[] = [];
  for (const task of suite.tasks) {
    const samples = (side: 'old' | 'new'): Sample[] => [1, 2, 3].map((sample) => {
      const value = sample + (side === 'new' ? 2 : 0);
      const output: NormalisedOutput = { text: '😀'.repeat(value), thinking: '', tool_calls: [], tool_calls_original: [],
        stop_reason: null, usage: { input_tokens: value, output_tokens: 0 }, latency_ms: value };
      return { run_id: 'r', task_id: task.id, sample, side, output, output_sha256: 'c'.repeat(64) };
    });
    const old = samples('old'), next = samples('new');
    for (const check of task.checks) {
      const oldStatuses: CheckStatus[] = ['pass', 'pass', 'fail'];
      const newStatuses: CheckStatus[] = check.id === 'a' ? ['pass', 'pass', 'pass'] : ['pass', 'fail', 'fail'];
      const results = (values: Sample[], statuses: CheckStatus[]) => values.map((sample, index) => ({ sample, result: {
        status: statuses[index], evidence: { field: 'text' as const, anchor: 0, context: '' }, expected: 'x', observed: 'y', detail: '',
      } }));
      cells.push({ task_id: task.id, check_id: check.id, check_type: check.type, check,
        old_results: results(old, oldStatuses), new_results: results(next, newStatuses), ...cellVerdict(oldStatuses, newStatuses, 3) });
    }
  }
  return { suite, manifest, cells };
}

describe('suite statistics are task-weighted diagnostics', () => {
  it('collapses two checks and three samples to one family observation per task', () => {
    const input = fixture(), before = JSON.stringify(input.cells), result = calculateSuiteStatistics(input);
    // Each old check has 2/3 passes. One new check has 1/3: conjunction makes 6 old-pass/new-fail task pairs.
    expect(result.mcnemar.find((line) => line.check_type === 'contains')).toMatchObject({ n: 6, b: 6, c: 0, raw_p: 2 / 64 });
    expect(result.tests).toHaveLength(21);
    expect(result.correction.denominator).toBe(4); // One family plus three nonzero n=6 metrics; seventeen absent families excluded.
    expect(result.mcnemar.find((line) => line.check_type === 'equals')).toMatchObject({ status: 'not_applicable', n: 0, raw_p: null, adjusted_p: null });
    // Side medians 2 and 4 -> difference 2 (astral text is counted in code points, not UTF-16 units).
    expect(result.continuous.find((line) => line.metric === 'answer_length')).toMatchObject({ n: 6, task_pairs: 6, median_difference: 2 });
    expect(result.continuous.find((line) => line.metric === 'cost_usd')).toMatchObject({ median_difference: 2 });
    expect(result.cost_label).toContain('synthetic check price, not spend');
    expect(result.diagnostic_only).toBe(true);
    expect(JSON.stringify(input.cells)).toBe(before); // Diagnostic semantics must never change any cell, counts, or verdict.
  });
  it('counts a CNJ family once, even when other checks of its type are judged', () => {
    const input = fixture();
    input.cells[0].verdict = 'COULD_NOT_JUDGE';
    input.cells[0].old_results[0].result.status = 'error';
    expect(calculateSuiteStatistics(input).mcnemar.find((line) => line.check_type === 'contains'))
      .toMatchObject({ n: 5, b: 5, excluded_could_not_judge: 1 });
  });
  it('excludes unknown usage/latency and missing output without shrinking side sample denominators', () => {
    const input = fixture();
    input.cells[0].old_results[0].sample.output!.usage = null;
    input.cells[2].new_results[0].sample.output!.latency_ms = null;
    input.cells[4].old_results[0].sample.output = null;
    const result = calculateSuiteStatistics(input);
    expect(result.continuous.find((line) => line.metric === 'cost_usd')).toMatchObject({ task_pairs: 4, n: 4,
      excluded_tasks: 2, excluded_unknown_usage: 1, excluded_missing_output: 1, status: 'insufficient', raw_p: null, adjusted_p: null });
    expect(result.continuous.find((line) => line.metric === 'latency_ms')).toMatchObject({ task_pairs: 4,
      excluded_unknown_metric: 1, excluded_missing_output: 1, status: 'insufficient' });
    expect(result.continuous.find((line) => line.metric === 'answer_length')).toMatchObject({ task_pairs: 5, excluded_missing_output: 1 });
    expect(result.correction.denominator).toBe(1);
  });
  it('takes the difference of side medians rather than a median of paired sample differences', () => {
    const input = fixture();
    for (const cell of input.cells) {
      [1, 100, 101].forEach((value, i) => { cell.old_results[i].sample.output!.latency_ms = value; });
      [2, 3, 102].forEach((value, i) => { cell.new_results[i].sample.output!.latency_ms = value; });
    }
    // median(new)-median(old)=3-100=-97; median([1,-97,1]) would incorrectly be 1.
    expect(calculateSuiteStatistics(input).continuous.find((line) => line.metric === 'latency_ms'))
      .toMatchObject({ median_difference: -97, bootstrap: { lower: -97, upper: -97 } });
  });
  it('excludes unavailable prices rather than treating unknown cost as zero', () => {
    const input = fixture();
    input.manifest.old_model = { ...input.manifest.old_model, check_prices: null, prices: null };
    expect(calculateSuiteStatistics(input).continuous.find((line) => line.metric === 'cost_usd'))
      .toMatchObject({ task_pairs: 0, n: 0, excluded_tasks: 6, excluded_unknown_metric: 6,
        status: 'not_applicable', raw_p: null, median_difference: null, bootstrap: null });
  });
  it('keeps zero differences in the bootstrap but drops them from the signed-rank n', () => {
    const input = fixture();
    for (const cell of input.cells) cell.new_results.forEach(({ sample }, i) => {
      sample.output!.latency_ms = cell.old_results[i].sample.output!.latency_ms;
    });
    expect(calculateSuiteStatistics(input).continuous.find((line) => line.metric === 'latency_ms'))
      .toMatchObject({ task_pairs: 6, n: 0, zero_differences: 6, status: 'insufficient', raw_p: null,
        bootstrap: { n: 6, estimate: 0, lower: 0, upper: 0 } });
  });
});
