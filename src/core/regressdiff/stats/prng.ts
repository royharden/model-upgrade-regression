/** Mulberry32. Integer seeds are reduced modulo 2^32, including manifest seeds. */
export function mulberry32(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0) throw new Error('Seed must be a nonnegative integer');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
