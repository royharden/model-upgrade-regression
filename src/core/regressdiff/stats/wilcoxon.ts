export interface WilcoxonResult {
  method: 'exact Wilcoxon signed-rank (doubled-rank DP)';
  status: 'ok' | 'insufficient'; n: number; zero_differences: number;
  w_plus: number; w_minus: number; doubled_ranks: number[]; raw_p: number | null;
}

/** Differences are paired task medians, new minus old. Zeros use the Wilcox convention. */
export function exactWilcoxon(differences: readonly number[]): WilcoxonResult {
  if (differences.some((value) => !Number.isFinite(value))) throw new Error('Differences must be finite');
  const ranked = differences.filter((value) => value !== 0).map((value) => ({ value, rank: 0 }))
    .sort((a, b) => Math.abs(a.value) - Math.abs(b.value));
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (end < ranked.length && Math.abs(ranked[end].value) === Math.abs(ranked[start].value)) end++;
    // Average of one-based ranks start+1..end, multiplied by 2: start+1+end.
    for (let i = start; i < end; i++) ranked[i].rank = start + 1 + end;
    start = end;
  }
  const total = ranked.reduce((sum, item) => sum + item.rank, 0);
  const positive = ranked.reduce((sum, item) => sum + (item.value > 0 ? item.rank : 0), 0);
  const result: WilcoxonResult = {
    method: 'exact Wilcoxon signed-rank (doubled-rank DP)', status: ranked.length < 6 ? 'insufficient' : 'ok',
    n: ranked.length, zero_differences: differences.length - ranked.length,
    w_plus: positive / 2, w_minus: (total - positive) / 2, doubled_ranks: ranked.map((item) => item.rank), raw_p: null,
  };
  if (ranked.length < 6) return result;
  // Each observation contributes its tied rank with probability .5, independently.
  const probability = Array<number>(total + 1).fill(0);
  probability[0] = 1;
  let reachable = 0;
  for (const { rank } of ranked) {
    for (let sum = reachable + rank; sum >= 0; sum--) {
      probability[sum] = ((sum <= reachable ? probability[sum] : 0) + (sum >= rank ? probability[sum - rank] : 0)) / 2;
    }
    reachable += rank;
  }
  const lower = Math.min(positive, total - positive);
  result.raw_p = Math.min(1, 2 * probability.slice(0, lower + 1).reduce((sum, mass) => sum + mass, 0));
  return result;
}
