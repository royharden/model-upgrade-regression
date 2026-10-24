import { describe, expect, it } from 'vitest';
import { normalise, NORMALISATION_VERSION } from '../../../src/core/regressdiff/normalise.ts';
import { canonical, utf8Bytes } from '../../../src/core/regressdiff/canonical.ts';
import { hashError, hashOutput, sha256 } from '../../../src/core/regressdiff/hash.ts';
import { anchorEvidence, fieldView, spanEvidence, MISSING_VIEW } from '../../../src/core/regressdiff/evidence.ts';

const task = { independent_tool_calls: false };
describe('normalisation v1: one test per normative rule', () => {
  it('1 converts CRLF and CR to LF', () => {
    expect(normalise({ text: 'a\r\nb\rc', thinking: 'x\ry' }, task)).toMatchObject({ text: 'a\nb\nc', thinking: 'x\ny' });
  });
  it('2 trims per-line and final trailing whitespace while preserving leading whitespace', () => {
    expect(normalise({ text: '  leading \t\nnext \t\n \n' }, task).text).toBe('  leading\nnext');
  });
  it('3 canonicalises a whole JSON value only; prose with embedded JSON is preserved', () => {
    expect(normalise({ text: '{"z":1,"a":{"y":2,"b":3}}' }, task).text).toBe('{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}');
    expect(normalise({ text: 'Here: {"z":1,"a":2}' }, task).text).toBe('Here: {"z":1,"a":2}');
    expect(normalise({ text: '[3,2,1]' }, task).text).toBe('[\n  3,\n  2,\n  1\n]');
  });
  it('4 canonicalises args, drops provider ids, and does not mutate raw input', () => {
    const raw = { tool_calls: [{ id: 'provider-id', name: 'search', args: '{"z":1,"a":2}' }] };
    const value = normalise(raw, task);
    expect(canonical(value.tool_calls[0].args)).toBe('{\n  "a": 2,\n  "z": 1\n}');
    expect(value.tool_calls[0]).not.toHaveProperty('id');
    expect(raw.tool_calls[0].id).toBe('provider-id');
  });
  it('5 preserves dependent order and sorts independent calls stably without deduplication', () => {
    const raw = { tool_calls: [{ name: 'z', args: { q: 2 } }, { name: 'a', args: {} }, { name: 'z', args: { q: 1 } }, { name: 'z', args: { q: 1 } }] };
    const dependent = normalise(raw, task);
    const independent = normalise(raw, { independent_tool_calls: true });
    expect(dependent.tool_calls).toEqual(dependent.tool_calls_original);
    expect(dependent.tool_calls.map((call) => call.name)).toEqual(['z', 'a', 'z', 'z']);
    expect(independent.tool_calls.map((call) => call.name)).toEqual(['a', 'z', 'z', 'z']);
    expect(independent.tool_calls.slice(1).map((call) => call.args)).toEqual([{ q: 1 }, { q: 1 }, { q: 2 }]);
    expect(independent.tool_calls_original).toEqual(dependent.tool_calls_original);
    expect(normalise(independent, { independent_tool_calls: true })).toEqual(independent);
  });
  it('6 routes typed thinking blocks away from answer text, preserving literal text tags as leaks', () => {
    expect(normalise({ blocks: [{ type: 'thinking', text: 'private' }, { type: 'text', text: 'public' }] }, task))
      .toMatchObject({ text: 'public', thinking: 'private' });
    expect(normalise({ text: '<think>leak</think>' }, task).text).toBe('<think>leak</think>');
  });
  it('7 performs no case-folding, bullet unification or paraphrase rewriting', () => {
    expect(normalise({ text: 'UPPER\n• item\nA car is quick.' }, task).text).toBe('UPPER\n• item\nA car is quick.');
    expect(NORMALISATION_VERSION).toBe('normalisation-v1');
  });
});
describe('hashes and evidence views', () => {
  it('preserves unavailable measurements as null and zero as zero', () => {
    expect(normalise({}, task)).toMatchObject({ stop_reason: null, usage: null, latency_ms: null });
    expect(normalise({ latency_ms: 0, usage: { input_tokens: 0, output_tokens: 0 } }, task).latency_ms).toBe(0);
    expect(normalise({ stop_reason: 'unrecognised_provider_reason' }, task).stop_reason).toBeNull();
  });
  it('hashes the original trace even when independent canonical calls are unchanged', () => {
    const calls = [{ name: 'z', args: {} }, { name: 'a', args: {} }];
    const before = normalise({ tool_calls: calls }, { independent_tool_calls: true });
    const after = normalise({ tool_calls: [...calls].reverse() }, { independent_tool_calls: true });
    expect(before.tool_calls).toEqual(after.tool_calls);
    expect(hashOutput(before)).not.toBe(hashOutput(after));
    expect(hashError('recorded failure')).toBe(sha256('error:recorded failure'));
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('keeps raw strings unescaped in views and canonicalises complex fields', () => {
    const value = normalise({ text: '😀\nanswer', latency_ms: 0 }, task);
    expect(fieldView(value, 'text')).toBe('😀\nanswer');
    expect(fieldView(value, 'tool_calls')).toBe('[]');
    expect(fieldView(value, 'usage')).toBe(MISSING_VIEW);
    expect(fieldView(value, 'latency_ms')).toBe('0');
    expect(spanEvidence(value, 'text', 0, 1)).toEqual({ field: 'text', start: 0, end: 1, quote: '😀' });
    expect(anchorEvidence(value, 'text', 1)).toEqual({ field: 'text', anchor: 1, context: '😀\nanswer' });
    expect(() => spanEvidence(value, 'text', 0, 99)).toThrow();
  });
  it('canonical JSON rejects lossy values and counts multibyte characters', () => {
    expect(() => canonical({ missing: undefined })).toThrow();
    expect(() => canonical(Infinity)).toThrow();
    expect(() => canonical(Array(1))).toThrow();
    expect(utf8Bytes('aé😀')).toBe(7);
    expect(canonical({ '2': 'two', '10': 'ten' })).toBe('{\n  "10": "ten",\n  "2": "two"\n}');
    expect(canonical(JSON.parse('{"__proto__":{"safe":true},"a":1}'))).toContain('"__proto__"');
  });
});
