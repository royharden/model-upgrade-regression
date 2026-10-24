import { describe, expect, it } from 'vitest';
import { benjaminiHochberg, bootstrapMedianDifference, exactMcNemar, exactWilcoxon, median,
  mulberry32, wilsonInterval } from '../../../src/core/regressdiff/stats/index.ts';

describe('exact statistical hand calculations', () => {
  it('McNemar sums the smaller discordant binomial tail, and handles no discordance', () => {
    // Six discordances: P(X<=1)=(C(6,0)+C(6,1))/64=7/64; two-sided=14/64.
    expect(exactMcNemar(1, 5)).toBe(14 / 64);
    expect(exactMcNemar(5, 1)).toBe(14 / 64);
    // All six change in one direction: two extreme sign allocations / 64.
    expect(exactMcNemar(6, 0)).toBe(2 / 64);
    expect(exactMcNemar(0, 0)).toBe(1);
    expect(exactMcNemar(3, 3)).toBe(1);
    expect(() => exactMcNemar(-1, 2)).toThrow();
  });
  it('Wilcoxon uses exact sign allocations, drops zeros, and never invents a small-n p-value', () => {
    // Ranks 1..6 sum to 21. All-positive has only all-plus/all-minus extremes: 2/2^6.
    const positive = exactWilcoxon([0, 1, 2, 3, 4, 5, 6]);
    expect(positive).toMatchObject({ status: 'ok', n: 6, zero_differences: 1, w_plus: 21, w_minus: 0, raw_p: 2 / 64 });
    expect(exactWilcoxon([-1, -2, -3, -4, -5, -6]).raw_p).toBe(2 / 64);
    expect(exactWilcoxon([0, 1, 2, 3, 4, 5])).toMatchObject({ status: 'insufficient', n: 5, zero_differences: 1, raw_p: null });
    expect(exactWilcoxon([0, 0])).toMatchObject({ status: 'insufficient', n: 0, zero_differences: 2, raw_p: null });
  });
  it('averages tied ranks using an integer doubled-rank null distribution', () => {
    // Six equal magnitudes get rank 3.5. Four positive, two negative: W-=7.
    // Tail contains 0,1,2 positives: (1+6+15)/64; two-sided=44/64.
    const tied = exactWilcoxon([1, 1, 1, -1, -1, 1]);
    expect(tied.doubled_ranks).toEqual([7, 7, 7, 7, 7, 7]);
    expect(tied).toMatchObject({ w_plus: 14, w_minus: 7, raw_p: 44 / 64 });
    // Doubled ranks [3,3,7,7,11,11], smaller sum 11.
    // <=11: empty(1), singletons(6), pair 3+3(1), pairs 3+7(4): 12/64; doubled=24/64.
    expect(exactWilcoxon([1, 1, 2, 2, 3, -3])).toMatchObject({ w_plus: 15.5, w_minus: 5.5, raw_p: 24 / 64 });
  });
  it('BH excludes null tests from its denominator and preserves original order', () => {
    // Three observed p-values .01,.03,.04 -> unpooled .03,.045,.04 -> cumulative minima .03,.04,.04.
    const values = [0.01, null, 0.04, 0.03, ...Array<null>(17).fill(null)];
    const result = benjaminiHochberg(values, 0.035);
    expect(result.denominator).toBe(3);
    expect(result.tests.map((test) => test.adjusted_p).slice(0, 4)).toEqual([0.03, null, 0.04, 0.04]);
    expect(result.tests.map((test) => test.significant).slice(0, 4)).toEqual([true, null, false, false]);
    expect(benjaminiHochberg([null, null]).denominator).toBe(0);
    expect(() => benjaminiHochberg([1.1])).toThrow();
  });
  it('reports a descriptive Wilson interval with a null empty denominator', () => {
    // With 0/n successes Wilson lower=0 and upper=z^2/(n+z^2); z=1.959963984540054.
    const z2 = 1.959963984540054 ** 2;
    expect(wilsonInterval(0, 10)?.lower).toBeCloseTo(0, 14);
    expect(wilsonInterval(0, 10)?.upper).toBeCloseTo(z2 / (10 + z2), 14);
    expect(wilsonInterval(5, 10)?.estimate).toBe(0.5);
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(() => wilsonInterval(11, 10)).toThrow();
  });
});

describe('seeded paired-task bootstrap', () => {
  it('uses mulberry32 deterministically and reduces integer seeds modulo 2^32', () => {
    const left = mulberry32(40), right = mulberry32(40), wrapped = mulberry32(40 + 4294967296);
    const sequence = Array.from({ length: 12 }, () => left());
    expect(sequence).toEqual(Array.from({ length: 12 }, () => right()));
    expect(sequence).toEqual(Array.from({ length: 12 }, () => wrapped()));
    expect(sequence.every((value) => value >= 0 && value < 1)).toBe(true);
  });
  it('resamples task differences 10000 times and leaves input observations untouched', () => {
    const observations = Object.freeze([-3, 0, 2, 7, 10]);
    const result = bootstrapMedianDifference(observations, 40);
    expect(result).toEqual(bootstrapMedianDifference(observations, 40));
    expect(result).toMatchObject({ iterations: 10000, seed: 40, n: 5, estimate: 2 });
    expect(result!.lower).toBeGreaterThanOrEqual(-3);
    expect(result!.upper).toBeLessThanOrEqual(10);
    // Every resample of a constant vector has median 4, so both percentile endpoints equal 4.
    expect(bootstrapMedianDifference([4, 4, 4], 9)).toMatchObject({ estimate: 4, lower: 4, upper: 4 });
    expect(bootstrapMedianDifference([], 9)).toBeNull();
    // Median([-3,7])=(-3+7)/2=2, computed without mutating the source.
    expect(median([-3, 7])).toBe(2);
  });
});
