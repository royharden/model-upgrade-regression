import defaultPolicy from '../../../fixtures/policy.json';
import { PolicySchema, type Policy } from './schema/policy.ts';
import type { RunManifest } from './schema/manifest.ts';
import { measuredCost } from './checks/cost_budget.ts';
import type { Cell, EvidenceFinding } from './findings.ts';

export interface CapBreach { metric: 'cost_usd' | 'latency_ms'; scope: 'per_task_median' | 'suite_total'; task_id: string | null; measured: number; cap: number }
export interface PolicyDecision {
  verdict: 'BLOCK' | 'REVIEW' | 'SAFE_WITH_NOTES'; rules: string[]; exit_code: 0 | 1 | 2; error_kind?: 'could_not_judge';
  raw_policy: Policy; effective_policy: Policy & { waived_finding_ids: string[]; blocking_waivers_ignored: string[] };
  regressed_count: number; effective_regressed_count: number; block_causing_ids: string[]; cap_breaches: CapBreach[]; notes: string[];
}
export interface PolicyInput { policy?: unknown; manifest: RunManifest; cells: readonly Cell[]; findings: readonly EvidenceFinding[]; needs_review?: readonly { id: string }[] }
const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2; };
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const policy = PolicySchema.parse(input.policy ?? defaultPolicy), rules: string[] = [], notes: string[] = [];
  const block = new Set<string>(), breaches: CapBreach[] = [];
  const regressions = input.findings.filter((finding) => finding.verdict === 'REGRESSED');
  const waived = (finding: EvidenceFinding) => finding.current_ruling?.kind === 'waived';
  const blocking = (finding: EvidenceFinding) => policy.always_blocking.includes(finding.check_type);
  const blockingActive = (finding: EvidenceFinding) => !waived(finding) || !policy.allow_waive_blocking;
  const addRule = (rule: string, findings: readonly EvidenceFinding[] = []) => { if (!rules.includes(rule)) rules.push(rule); findings.forEach((finding) => block.add(finding.id)); };
  const b1 = regressions.filter((finding) => blocking(finding) && blockingActive(finding));
  if (b1.length) addRule('B1', b1);
  const b2 = input.findings.filter((finding) => {
    const { old_counts: old, new_counts: next } = finding.cell;
    const judged = old.pass + old.fail;
    return blocking(finding) && blockingActive(finding) && judged > 0 && old.pass * 2 > judged && next.fail > 0;
  });
  if (b2.length) addRule('B2', b2);
  const effectiveRegressions = regressions.filter((finding) => !waived(finding));
  if (effectiveRegressions.length > policy.max_regressions) addRule('B3', effectiveRegressions);
  // Deduplicate cells by task: multiple checks never multiply a task's measured cost or latency.
  const tasks = new Map<string, Cell>();
  input.cells.forEach((cell) => { if (!tasks.has(cell.task_id)) tasks.set(cell.task_id, cell); });
  const capUnavailable: string[] = [];
  for (const metric of ['cost_usd', 'latency_ms'] as const) {
    const caps = metric === 'cost_usd' ? policy.cost_cap : policy.latency_cap;
    if (caps.per_task_median === null && caps.suite_total === null) continue;
    const medians: { task_id: string; value: number }[] = [];
    for (const [task_id, cell] of tasks) {
      const values = cell.new_results.map(({ sample }) => !sample.output ? null : metric === 'cost_usd'
        ? measuredCost(sample.output, input.manifest.new_model.check_prices ?? input.manifest.new_model.prices) : sample.output.latency_ms);
      // Do not shrink the denominator by dropping unavailable samples.
      if (values.length !== input.manifest.k || values.some((value) => value === null)) { capUnavailable.push(`${metric}:${task_id}`); continue; }
      const value = median(values as number[]);
      medians.push({ task_id, value });
      if (caps.per_task_median !== null && value > caps.per_task_median) breaches.push({ metric, scope: 'per_task_median', task_id, measured: value, cap: caps.per_task_median });
    }
    const total = medians.reduce((sum, item) => sum + item.value, 0);
    // A known partial sum already exceeding a hard cap proves a breach; an unknown remainder cannot clear it.
    if (caps.suite_total !== null && total > caps.suite_total) breaches.push({ metric, scope: 'suite_total', task_id: null, measured: total, cap: caps.suite_total });
  }
  if (breaches.length) {
    addRule('B4', input.findings.filter((finding) => breaches.some((breach) =>
      (breach.task_id === null || breach.task_id === finding.task_id) && finding.check_type === (breach.metric === 'cost_usd' ? 'cost_budget' : 'latency_budget'))));
    notes.push('Hard caps are independent of check verdicts and cannot be waived. Suite totals sum per-task new-side medians.');
  }
  const hazards = input.findings.filter((finding) => finding.verdict === 'PRE_EXISTING' && blocking(finding) && finding.cell.new_counts.fail > 0);
  if (hazards.length && policy.block_preexisting_hazards) addRule('B_PREEXISTING_HAZARD', hazards);
  const review: string[] = [];
  if (input.findings.some((finding) => finding.verdict === 'COULD_NOT_JUDGE')) review.push('R_COULD_NOT_JUDGE');
  if (input.findings.some((finding) => finding.support === 'unsupported')) review.push('R_UNSUPPORTED');
  if (input.needs_review?.length) review.push('R_NEEDS_REVIEW');
  if (input.findings.some((finding) => finding.current_ruling?.kind === 'retest')) review.push('R_RETEST');
  if (effectiveRegressions.length) review.push('R_REGRESSED');
  if (hazards.length && !policy.block_preexisting_hazards) review.push('R_PREEXISTING_HAZARD');
  if (capUnavailable.length) { review.push('R_CAP_UNAVAILABLE'); notes.push(`Hard-cap measurements unavailable: ${capUnavailable.join(', ')}`); }
  const nothingJudged = !input.cells.some((cell) => cell.old_counts.pass + cell.old_counts.fail + cell.new_counts.pass + cell.new_counts.fail > 0);
  if (nothingJudged) review.push('R_NOTHING_JUDGED');
  const unresolved = input.findings.some((finding) => finding.verdict === 'COULD_NOT_JUDGE' && !['confirmed', 'waived'].includes(finding.current_ruling?.kind ?? ''));
  const verdict = rules.length ? 'BLOCK' : review.length ? 'REVIEW' : 'SAFE_WITH_NOTES';
  rules.push(...review);
  if (verdict === 'SAFE_WITH_NOTES') rules.push('S_NO_BLOCK_OR_REVIEW_RULE');
  const exit_code = verdict === 'BLOCK' ? 1 : unresolved || nothingJudged ? 2 : 0;
  return { verdict, rules, exit_code, ...(exit_code === 2 ? { error_kind: 'could_not_judge' as const } : {}),
    raw_policy: policy, effective_policy: { ...policy, waived_finding_ids: input.findings.filter(waived).map((finding) => finding.id),
      blocking_waivers_ignored: input.findings.filter((finding) => waived(finding) && blocking(finding) && !policy.allow_waive_blocking).map((finding) => finding.id) },
    regressed_count: regressions.length, effective_regressed_count: effectiveRegressions.length, block_causing_ids: [...block], cap_breaches: breaches,
    notes: [...notes, 'Statistics are diagnostic only and never change cell verdicts.', ...(input.manifest.mode === 'demo' ? ['Offline cost uses synthetic check price, not spend.'] : [])] };
}
