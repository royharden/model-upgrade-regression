export const CANONICAL_VERSION = 'canonical-v1';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** JSON only: reject lossy/non-finite/undefined values rather than silently hashing them. */
export function canonical(value: unknown, indent = 2): string {
  const ancestors = new Set<object>();
  function visit(item: unknown): JsonValue {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || item === null) throw new Error('Expected a JSON value');
    if (ancestors.has(item)) throw new Error('Cyclic JSON value');
    ancestors.add(item);
    let result: JsonValue;
    if (Array.isArray(item)) result = Array.from(item, visit);
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        throw new Error('Expected a plain JSON object');
      }
      const sorted: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const key of Object.keys(item).sort()) sorted[key] = visit((item as Record<string, unknown>)[key]);
      result = sorted;
    }
    ancestors.delete(item);
    return result;
  }
  const json = visit(value);
  // Write objects ourselves: JSON.stringify would put integer-like keys in numeric order.
  function write(item: JsonValue, depth: number): string {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    const entries = Array.isArray(item)
      ? item.map((child) => write(child, depth + 1))
      : Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${indent ? ' ' : ''}${write(item[key], depth + 1)}`);
    const [open, close] = Array.isArray(item) ? ['[', ']'] : ['{', '}'];
    if (entries.length === 0) return `${open}${close}`;
    if (!indent) return `${open}${entries.join(',')}${close}`;
    return `${open}\n${' '.repeat((depth + 1) * indent)}${entries.join(`,\n${' '.repeat((depth + 1) * indent)}`)}\n${' '.repeat(depth * indent)}${close}`;
  }
  if (!Number.isInteger(indent) || indent < 0 || indent > 10) throw new Error('Invalid canonical indentation');
  return write(json, 0);
}

/** Count UTF-8 bytes without DOM, Node, Deno, or runtime-specific encoders. */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
