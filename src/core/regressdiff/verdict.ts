import type { CheckStatus } from './evidence.ts';
import { KSchema } from './schema/manifest.ts';

export const VERDICT_RULE_VERSION = 'verdict-rule-v1';
export type JudgedVerdict = 'REGRESSED' | 'IMPROVED' | 'UNCHANGED' | 'WITHIN_NOISE' | 'PRE_EXISTING';
export type CellVerdict = JudgedVerdict | 'COULD_NOT_JUDGE';
export interface Counts { pass: number; fail: number; error: number }
export interface VerdictResult {
  verdict: CellVerdict; old_counts: Counts; new_counts: Counts; error_counts: { old: number; new: number };
  provisional?: { verdict: JudgedVerdict | null; paired_judged: number; information_only: true };
  instability_note?: string;
}
const counts = (values: readonly CheckStatus[]): Counts => ({
  pass: values.filter((value) => value === 'pass').length, fail: values.filter((value) => value === 'fail').length,
  error: values.filter((value) => value === 'error').length,
});
function judged(oldPass: number, newPass: number, n: number): JudgedVerdict {
  const oldMajority = 2 * oldPass > n;
  const newMajority = 2 * newPass > n;
  if (oldMajority && !newMajority) return 'REGRESSED';
  if (!oldMajority && newMajority) return 'IMPROVED';
  if (!oldMajority && !newMajority) return 'PRE_EXISTING';
  const threshold = Math.max(Math.min(oldPass, n - oldPass), 1);
  if (oldPass - newPass > threshold) return 'REGRESSED';
  if (newPass - oldPass > threshold) return 'IMPROVED';
  return oldPass === newPass ? 'UNCHANGED' : 'WITHIN_NOISE';
}
export function cellVerdict(old: readonly CheckStatus[], next: readonly CheckStatus[], k: 1 | 3 | 5): VerdictResult {
  KSchema.parse(k);
  if (old.length !== k || next.length !== k || [...old, ...next].some((status) => !['pass', 'fail', 'error'].includes(status))) {
    throw new Error('A cell must contain exactly k valid statuses per side');
  }
  const old_counts = counts(old), new_counts = counts(next);
  const base = { old_counts, new_counts, error_counts: { old: old_counts.error, new: new_counts.error } };
  if (old_counts.error + new_counts.error > 0) {
    const complete = old.map((value, index) => ({ old: value, next: next[index] })).filter((pair) => pair.old !== 'error' && pair.next !== 'error');
    return { ...base, verdict: 'COULD_NOT_JUDGE', provisional: {
      verdict: complete.length ? judged(complete.filter((pair) => pair.old === 'pass').length, complete.filter((pair) => pair.next === 'pass').length, complete.length) : null,
      paired_judged: complete.length, information_only: true,
    } };
  }
  const verdict = judged(old_counts.pass, new_counts.pass, k);
  return { ...base, verdict, ...(verdict === 'UNCHANGED' && old_counts.pass < k ? { instability_note: 'Equal pass counts include failing samples' } : {}) };
}
