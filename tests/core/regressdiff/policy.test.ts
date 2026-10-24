import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../../../src/core/regressdiff/policy.ts';
import { sortFindings } from '../../../src/core/regressdiff/sort.ts';
import { equalsCheck, hazard, hazardCheck, relaxedPolicy, ruling, safe, scenario } from './m3-fixtures.ts';

describe('named suite policy rules', () => {
  it('B1 blocks an always-blocking regression; default waiver cannot lift B1 or B2', () => {
    const initial = scenario([safe], [hazard], hazardCheck), id = initial.findings[0].id;
    expect(initial.decision).toMatchObject({ verdict: 'BLOCK', exit_code: 1 });
    expect(initial.decision.rules).toContain('B1');
    const waived = scenario([safe], [hazard], hazardCheck, relaxedPolicy, [ruling(id, 'waived')]);
    expect(waived.decision.rules).toEqual(expect.arrayContaining(['B1', 'B2']));
    expect(waived.decision.effective_policy.blocking_waivers_ignored).toEqual([id]);
    expect(waived.findings[0]).toMatchObject({ block_causing: true, original_severity: 'REGRESSED', current_ruling: { kind: 'waived' } });
    const allowed = scenario([safe], [hazard], hazardCheck, { ...relaxedPolicy, allow_waive_blocking: true }, [ruling(id, 'waived')]);
    expect(allowed.decision.verdict).toBe('SAFE_WITH_NOTES');
  });
  it('B2 blocks one new failure inside WITHIN_NOISE and inside a COULD_NOT_JUDGE cell', () => {
    const noisy = scenario([safe, safe, safe], [safe, hazard, safe], hazardCheck);
    expect(noisy.findings[0].verdict).toBe('WITHIN_NOISE');
    expect(noisy.decision.rules).toContain('B2'); expect(noisy.decision.rules).not.toContain('B1');
    const abstained = scenario([safe, null, safe], [safe, hazard, safe], hazardCheck);
    expect(abstained.findings[0].verdict).toBe('COULD_NOT_JUDGE');
    expect(abstained.decision).toMatchObject({ verdict: 'BLOCK', exit_code: 1 });
    expect(abstained.decision.rules).toContain('B2');
  });
  it('B2 retains a noisy UNCHANGED hazard and cannot count an old-side failure majority as safe', () => {
    const unchanged = scenario([safe, hazard, safe], [safe, hazard, safe], hazardCheck);
    expect(unchanged.findings[0].verdict).toBe('UNCHANGED');
    expect(unchanged.decision.rules).toContain('B2');
    const preexisting = scenario([hazard, hazard, safe], [hazard, hazard, safe], hazardCheck);
    expect(preexisting.decision.rules).not.toContain('B2');
    expect(preexisting.decision.rules).toContain('R_PREEXISTING_HAZARD');
  });
  it('B3 uses the effective count while retaining waived regressions in raw policy/report data', () => {
    const policy = { ...relaxedPolicy, max_regressions: 0 };
    const raw = scenario([safe], [{ ...safe, text: 'wrong' }], equalsCheck, policy);
    expect(raw.decision.rules).toContain('B3');
    const waived = scenario([safe], [{ ...safe, text: 'wrong' }], equalsCheck, policy, [ruling(raw.findings[0].id, 'waived')]);
    expect(waived.decision).toMatchObject({ verdict: 'SAFE_WITH_NOTES', regressed_count: 1, effective_regressed_count: 0 });
    expect(waived.findings).toHaveLength(1); expect(waived.decision.raw_policy.max_regressions).toBe(0);
  });
  it.each(['cost_usd', 'latency_ms'] as const)('B4 blocks the hard %s cap independently of unchanged checks and waivers', (metric) => {
    const policy = { ...relaxedPolicy, ...(metric === 'cost_usd' ? { cost_cap: { per_task_median: 0.0001, suite_total: 0.0001 } }
      : { latency_cap: { per_task_median: 50, suite_total: 50 } }) };
    // Mock check price: (100*1 + 100*4)/1e6 = USD0.0005; spend remains zero.
    const result = scenario([safe], [safe], equalsCheck, policy);
    expect(result.cells[0].verdict).toBe('UNCHANGED');
    expect(result.decision).toMatchObject({ verdict: 'BLOCK', exit_code: 1 });
    expect(result.decision.rules).toContain('B4');
    expect(result.decision.cap_breaches.map((breach) => breach.scope)).toEqual(['per_task_median', 'suite_total']);
    expect(result.decision.cap_breaches.every((breach) => breach.metric === metric)).toBe(true);
  });
  it('B4 is not lifted by a waiver, and per-task caps use the full new-side median', () => {
    const policy = { ...relaxedPolicy, latency_cap: { per_task_median: 50, suite_total: null } };
    const first = scenario([safe], [{ ...safe, text: 'wrong' }], equalsCheck, policy);
    const waived = scenario([safe], [{ ...safe, text: 'wrong' }], equalsCheck, policy, [ruling(first.findings[0].id, 'waived')]);
    expect(waived.decision.rules).toContain('B4'); expect(waived.decision.exit_code).toBe(1);
    expect(scenario([safe, safe, safe], [{ ...safe, latency_ms: 0 }, { ...safe, latency_ms: 40 }, { ...safe, latency_ms: 1000 }], equalsCheck, policy).decision.verdict).toBe('SAFE_WITH_NOTES');
    expect(scenario([safe], [{ ...safe, latency_ms: null }], equalsCheck, policy).decision.rules).toContain('R_CAP_UNAVAILABLE');
  });
  it('names ordinary REVIEW, SAFE_WITH_NOTES, pre-existing hazard and opt-in blocking', () => {
    expect(scenario([safe], [{ ...safe, text: 'wrong' }]).decision).toMatchObject({ verdict: 'REVIEW', exit_code: 0, rules: ['R_REGRESSED'] });
    expect(scenario([safe], [safe]).decision).toMatchObject({ verdict: 'SAFE_WITH_NOTES', exit_code: 0 });
    const preexisting = scenario([hazard], [hazard], hazardCheck);
    expect(preexisting.decision).toMatchObject({ verdict: 'REVIEW', exit_code: 0 });
    expect(scenario([hazard], [hazard], hazardCheck, { ...relaxedPolicy, block_preexisting_hazards: true }).decision.rules).toContain('B_PREEXISTING_HAZARD');
  });
  it('distinguishes unresolved uncertainty, confirmed/waived uncertainty and retest', () => {
    const raw = scenario([null], [safe]);
    expect(raw.decision).toMatchObject({ verdict: 'REVIEW', exit_code: 2, error_kind: 'could_not_judge' });
    for (const kind of ['confirmed', 'waived'] as const) expect(scenario([null], [safe], equalsCheck, relaxedPolicy, [ruling(raw.findings[0].id, kind)]).decision.exit_code).toBe(0);
    const retest = scenario([null], [safe], equalsCheck, relaxedPolicy, [ruling(raw.findings[0].id, 'retest')]);
    expect(retest.decision.rules).toContain('R_RETEST'); expect(retest.decision.exit_code).toBe(2);
    expect(scenario([null], [null]).decision.rules).toContain('R_NOTHING_JUDGED');
  });
  it('unsupported evidence forces REVIEW and sorts ahead of abstentions while regressions lead', () => {
    const baseline = scenario([safe], [{ ...safe, text: 'wrong' }]);
    const unsupported = { ...baseline.findings[0], verdict: 'IMPROVED' as const, support: 'unsupported' as const, task_id: 'unsupported' };
    const cnj = { ...baseline.findings[0], verdict: 'COULD_NOT_JUDGE' as const, task_id: 'error' };
    const decision = evaluatePolicy({ ...baseline, findings: [unsupported], policy: relaxedPolicy });
    expect(decision).toMatchObject({ verdict: 'REVIEW', rules: ['R_UNSUPPORTED'] });
    expect(sortFindings([cnj, unsupported, baseline.findings[0]]).map((finding) => finding.task_id)).toEqual(['task', 'unsupported', 'error']);
    expect(evaluatePolicy({ ...baseline, findings: [], policy: relaxedPolicy, needs_review: [{ id: 'semantic-only' }] }).rules).toContain('R_NEEDS_REVIEW');
  });
  it('rejects malformed policy rather than treating it as a safe policy', () => {
    expect(() => scenario([safe], [safe], equalsCheck, { ...relaxedPolicy, max_regressions: -1 })).toThrow();
  });
});
