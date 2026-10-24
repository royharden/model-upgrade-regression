export interface WilsonInterval {
  method: 'Wilson score 95%'; successes: number; n: number; estimate: number; lower: number; upper: number;
}
/** Descriptive interval only; clustered benchmark variants are not independent trials. */
export function wilsonInterval(successes: number, n: number): WilsonInterval | null {
  if (![successes, n].every((value) => Number.isSafeInteger(value) && value >= 0) || successes > n) throw new Error('Invalid binomial counts');
  if (n === 0) return null;
  const z = 1.959963984540054, z2 = z * z, estimate = successes / n;
  const denominator = 1 + z2 / n, center = (estimate + z2 / (2 * n)) / denominator;
  const half = z * Math.sqrt(estimate * (1 - estimate) / n + z2 / (4 * n * n)) / denominator;
  return { method: 'Wilson score 95%', successes, n, estimate, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}
