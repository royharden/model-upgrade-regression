import { describe, expect, it } from 'vitest';
import { cellVerdict, type CellVerdict } from '../../../src/core/regressdiff/verdict.ts';
import type { CheckStatus } from '../../../src/core/regressdiff/evidence.ts';

function statuses(k: number, pass: number, errors = 0): CheckStatus[] {
  return [...Array<CheckStatus>(pass).fill('pass'), ...Array<CheckStatus>(k - pass - errors).fill('fail'), ...Array<CheckStatus>(errors).fill('error')];
}
describe('verdict-rule v1 named vectors', () => {
  const vectors: [1 | 3 | 5, number, number, CellVerdict][] = [
    [1, 1, 1, 'UNCHANGED'], [1, 1, 0, 'REGRESSED'], [1, 0, 1, 'IMPROVED'], [1, 0, 0, 'PRE_EXISTING'],
    [3, 3, 2, 'WITHIN_NOISE'], [3, 3, 1, 'REGRESSED'], [3, 2, 1, 'REGRESSED'], [3, 1, 2, 'IMPROVED'],
    [3, 1, 0, 'PRE_EXISTING'], [3, 0, 0, 'PRE_EXISTING'], [5, 5, 4, 'WITHIN_NOISE'], [5, 5, 3, 'REGRESSED'],
    [5, 4, 3, 'WITHIN_NOISE'], [5, 3, 2, 'REGRESSED'], [3, 2, 3, 'WITHIN_NOISE'],
  ];
  it.each(vectors)('k=%i, %i -> %i is %s', (k, old, next, expected) => {
    expect(cellVerdict(statuses(k, old), statuses(k, next), k).verdict).toBe(expected);
  });
  it('keeps errors at fixed k and reports paired-judged provisional information only', () => {
    const result = cellVerdict(['pass', 'error', 'pass'], ['fail', 'pass', 'fail'], 3);
    expect(result.verdict).toBe('COULD_NOT_JUDGE');
    expect(result.old_counts).toEqual({ pass: 2, fail: 0, error: 1 });
    expect(result.error_counts).toEqual({ old: 1, new: 0 });
    expect(result.provisional).toEqual({ verdict: 'REGRESSED', paired_judged: 2, information_only: true });
    expect(cellVerdict(['error'], ['pass'], 1).provisional).toEqual({ verdict: null, paired_judged: 0, information_only: true });
  });
  it('notes instability for equal passing-majority counts that include failure', () => {
    expect(cellVerdict(statuses(3, 2), statuses(3, 2), 3).instability_note).toBeDefined();
    expect(cellVerdict(statuses(3, 3), statuses(3, 3), 3).instability_note).toBeUndefined();
  });
  it('rejects shrinking or invalid denominators', () => {
    expect(() => cellVerdict(['pass'], ['pass'], 3)).toThrow();
    expect(() => cellVerdict(['pass', 'pass'], ['pass', 'pass'], 2 as 3)).toThrow();
  });
});
describe('exhaustive grid over every valid pass/error count per side for k=1,3,5', () => {
  for (const k of [1, 3, 5] as const) for (let oldPass = 0; oldPass <= k; oldPass++) for (let newPass = 0; newPass <= k; newPass++) {
    for (let oldError = 0; oldError <= k - oldPass; oldError++) for (let newError = 0; newError <= k - newPass; newError++) {
      it(`${k}: old P${oldPass} E${oldError}, new P${newPass} E${newError}`, () => {
        const actual = cellVerdict(statuses(k, oldPass, oldError), statuses(k, newPass, newError), k);
        const oldMajority = oldPass > k / 2, newMajority = newPass > k / 2;
        const floor = Math.max(Math.min(oldPass, k - oldPass), 1);
        // An independent piecewise reference records each mutually exclusive branch.
        const branches = [
          [oldError + newError > 0, 'COULD_NOT_JUDGE'],
          [oldError + newError === 0 && oldMajority && !newMajority, 'REGRESSED'],
          [oldError + newError === 0 && !oldMajority && newMajority, 'IMPROVED'],
          [oldError + newError === 0 && !oldMajority && !newMajority, 'PRE_EXISTING'],
          [oldError + newError === 0 && oldMajority && newMajority && oldPass - newPass > floor, 'REGRESSED'],
          [oldError + newError === 0 && oldMajority && newMajority && newPass - oldPass > floor, 'IMPROVED'],
          [oldError + newError === 0 && oldMajority && newMajority && oldPass === newPass, 'UNCHANGED'],
          [oldError + newError === 0 && oldMajority && newMajority && oldPass !== newPass && Math.abs(oldPass - newPass) <= floor, 'WITHIN_NOISE'],
        ] as const;
        const matches = branches.filter(([condition]) => condition);
        expect(matches).toHaveLength(1);
        expect(actual.verdict).toBe(matches[0][1]);
        expect(Object.values(actual.old_counts).reduce((sum, count) => sum + count, 0)).toBe(k);
        expect(Object.values(actual.new_counts).reduce((sum, count) => sum + count, 0)).toBe(k);
        expect(actual.provisional !== undefined).toBe(oldError + newError > 0);
      });
    }
  }
});
