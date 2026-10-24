/** Exact two-sided conditional McNemar p; b=old-pass/new-fail, c=old-fail/new-pass. */
export function exactMcNemar(b: number, c: number): number {
  if (![b, c].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('Discordant counts must be nonnegative integers');
  const n = b + c;
  if (n === 0) return 1;
  // Sum Bin(n, .5) lower tail. Suite size is bounded at 100 tasks.
  let mass = 2 ** -n, tail = mass;
  for (let i = 1; i <= Math.min(b, c); i++) {
    mass *= (n - i + 1) / i;
    tail += mass;
  }
  return Math.min(1, 2 * tail);
}
