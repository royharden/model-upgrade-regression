import { mulberry32 } from './prng.ts';

export const BOOTSTRAP_ITERATIONS = 10_000;
export interface BootstrapInterval {
  method: 'paired-task percentile bootstrap 95% (linear quantiles)';
  iterations: 10000; seed: number; n: number; estimate: number; lower: number; upper: number;
}
export function median(values: readonly number[]): number {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error('Median requires finite observations');
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
}
function quantile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction, left = Math.floor(position), weight = position - left;
  return sorted[left] * (1 - weight) + sorted[Math.ceil(position)] * weight;
}
/** Resample whole paired tasks, never individual samples or checks. */
export function bootstrapMedianDifference(differences: readonly number[], seed: number): BootstrapInterval | null {
  if (!differences.length) return null;
  const estimate = median(differences), random = mulberry32(seed), estimates: number[] = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i++) {
    const resample = Array.from({ length: differences.length }, () => differences[Math.floor(random() * differences.length)]);
    estimates.push(median(resample));
  }
  estimates.sort((a, b) => a - b);
  return { method: 'paired-task percentile bootstrap 95% (linear quantiles)', iterations: BOOTSTRAP_ITERATIONS,
    seed, n: differences.length, estimate, lower: quantile(estimates, 0.025), upper: quantile(estimates, 0.975) };
}
