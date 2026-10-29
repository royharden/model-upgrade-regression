export interface AdjustedP { raw_p: number | null; adjusted_p: number | null; significant: boolean | null }
export interface BHResult { method: 'Benjamini-Hochberg'; q: number; denominator: number; tests: AdjustedP[] }
/** N/A and insufficient tests are null and never enter the correction denominator. */
export function benjaminiHochberg(values: readonly (number | null)[], q = 0.05): BHResult {
  if (!Number.isFinite(q) || q <= 0 || q > 1) throw new Error('q must be in (0, 1]');
  if (values.some((p) => p !== null && (!Number.isFinite(p) || p < 0 || p > 1))) throw new Error('p must be null or in [0, 1]');
  const ordered = values.flatMap((p, index) => p === null ? [] : [{ p, index }]).sort((a, b) => a.p - b.p || a.index - b.index);
  const tests: AdjustedP[] = values.map((raw_p) => ({ raw_p, adjusted_p: null, significant: null }));
  let upper = 1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    upper = Math.min(upper, ordered[i].p * ordered.length / (i + 1));
    tests[ordered[i].index] = { raw_p: ordered[i].p, adjusted_p: upper, significant: upper <= q };
  }
  return { method: 'Benjamini-Hochberg', q, denominator: ordered.length, tests };
}
