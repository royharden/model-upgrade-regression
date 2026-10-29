import { compare, type Comparison } from '../../../src/core/regressdiff/compare.ts';
import { makeSample } from '../../../src/core/regressdiff/pairing.ts';
import { normalise, type NormalisationInput } from '../../../src/core/regressdiff/normalise.ts';
import type { CheckConfig } from '../../../src/core/regressdiff/checks/index.ts';
import type { Policy } from '../../../src/core/regressdiff/schema/policy.ts';
import type { RulingEvent } from '../../../src/core/regressdiff/rulings.ts';

export const relaxedPolicy: Policy = { max_regressions: 10, always_blocking: ['tool_forbidden', 'tool_order'],
  cost_cap: { per_task_median: null, suite_total: null }, latency_cap: { per_task_median: null, suite_total: null },
  allow_waive_blocking: false, block_preexisting_hazards: false };
export const safe: NormalisationInput = { text: 'ok', usage: { input_tokens: 100, output_tokens: 100 }, latency_ms: 100, stop_reason: 'end_turn' };
export const hazard: NormalisationInput = { ...safe, tool_calls: [{ name: 'delete', args: { path: '/fixture' } }] };
export const equalsCheck: CheckConfig = { id: 'check', type: 'equals', params: { value: 'ok' } };
export const hazardCheck: CheckConfig = { id: 'check', type: 'tool_forbidden', params: { name: 'delete' } };
export function scenario(old: readonly (NormalisationInput | null)[], next: readonly (NormalisationInput | null)[], check: CheckConfig = equalsCheck, policy: Policy = relaxedPolicy, rulings: readonly RulingEvent[] = []): Comparison {
  const k = old.length as 1 | 3 | 5;
  const task = { id: 'task', category: 'constraint', messages: [{ role: 'user', content: 'fixture' }], tools: [], checks: [check], independent_tool_calls: false };
  const samples = (['old', 'new'] as const).flatMap((side) => (side === 'old' ? old : next).map((value, index) => makeSample('m3-tests', side,
    { task_id: 'task', sample: index + 1, ...(value === null ? { output: null, error: 'recorded_fixture_error' } : { output: normalise(value, task) }) })));
  return compare({ suite: { id: 'suite', name: 'M3 cases', tasks: [task] }, run_id: 'm3-tests', owner_id: 'owner', args: { k, old_model: 'mock:old', new_model: 'mock:new' }, samples, policy, rulings });
}
export function ruling(finding_id: string, kind: 'waived' | 'confirmed' | 'retest'): RulingEvent {
  return { id: 'ruling-1', finding_id, owner_id: 'owner', run_id: 'm3-tests', kind, reason: 'Reviewed fixture evidence',
    supersedes: null, created_at: '2026-10-24T12:00:00.000Z' };
}
