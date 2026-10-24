import { describe, expect, it } from 'vitest';
import { CHECK_TYPES, checks, runCheck, type CheckContext, type CheckType } from '../../../src/core/regressdiff/checks/index.ts';
import { measuredCost } from '../../../src/core/regressdiff/checks/cost_budget.ts';
import { regexWarning } from '../../../src/core/regressdiff/checks/regex-guard.ts';
import { fieldView } from '../../../src/core/regressdiff/evidence.ts';
import { CheckResultSchema } from '../../../src/core/regressdiff/schema/report.ts';
import { normalise } from '../../../src/core/regressdiff/normalise.ts';
import type { NormalisedOutput } from '../../../src/core/regressdiff/schema/output.ts';
import { output, syntheticContext } from './helpers.ts';

interface Case { type: CheckType; params: Record<string, unknown>; pass: NormalisedOutput; fail: NormalisedOutput; context?: CheckContext }
const tool = (name = 'search', args: unknown = { q: 'hello' }) => ({ name, args });
const cases: Case[] = [
  { type: 'equals', params: { value: 'OK' }, pass: output({ text: 'OK' }), fail: output({ text: 'ok' }) },
  { type: 'contains', params: { value: 'answer' }, pass: output(), fail: output({ text: 'missing' }) },
  { type: 'regex', params: { pattern: '^OK\\s+answer$' }, pass: output(), fail: output({ text: 'bad' }) },
  { type: 'is_json', params: {}, pass: output({ text: '{"a":1}' }), fail: output({ text: '{bad' }) },
  { type: 'json_schema', params: { schema: { type: 'object', required: ['a'], properties: { a: { type: 'number' } } } },
    pass: output({ text: '{"a":1}' }), fail: output({ text: '{"a":"x"}' }) },
  { type: 'length', params: { min: 2, max: 2 }, pass: output({ text: '😀x' }), fail: output({ text: '😀xy' }) },
  { type: 'starts_with', params: { value: 'OK' }, pass: output(), fail: output({ text: 'not OK' }) },
  { type: 'bullet_count', params: { min: 2, max: 2 }, pass: output({ text: '• one\n2) two' }), fail: output({ text: 'plain prose' }) },
  { type: 'no_banned_words', params: { words: ['secret'] }, pass: output(), fail: output({ text: 'A SECRET appears' }) },
  { type: 'thinking_leak', params: {}, pass: output({ thinking: 'private', text: 'answer' }), fail: output({ text: 'A <think> leak' }) },
  { type: 'refusal', params: { expected: 'answered' }, pass: output(), fail: output({ text: 'I cannot help with that' }) },
  { type: 'stop_reason', params: { expected: 'end_turn' }, pass: output(), fail: output({ stop_reason: 'max_tokens' }) },
  { type: 'tool_called', params: { name: 'search' }, pass: output({ tool_calls: [tool()] }), fail: output() },
  { type: 'tool_args', params: { name: 'search', expected: { q: 'hello' } }, pass: output({ tool_calls: [tool()] }), fail: output({ tool_calls: [tool('search', { q: 'other' })] }) },
  { type: 'tool_order', params: { names: ['search', 'save'] }, pass: output({ tool_calls: [tool(), tool('extra'), tool('save')] }), fail: output({ tool_calls: [tool('save'), tool()] }) },
  { type: 'tool_forbidden', params: { name: 'delete' }, pass: output({ tool_calls: [tool()] }), fail: output({ tool_calls: [tool('delete'), tool('delete')] }) },
  { type: 'cost_budget', params: { max_usd: 0.001 }, pass: output(), fail: output({ usage: { input_tokens: 1000, output_tokens: 1000 } }), context: syntheticContext },
  { type: 'latency_budget', params: { max_ms: 100 }, pass: output(), fail: output({ latency_ms: 101 }) },
];

describe('all 18 deterministic check contracts', () => {
  it('registers exactly the planned types and a params schema for each', () => {
    expect(CHECK_TYPES).toHaveLength(18);
    expect(new Set(cases.map((row) => row.type))).toEqual(new Set(CHECK_TYPES));
    for (const definition of Object.values(checks)) expect(definition.params.safeParse).toBeTypeOf('function');
  });
  for (const row of cases) describe(row.type, () => {
    for (const status of ['pass', 'fail'] as const) it(`returns ${status} with resolvable canonical evidence`, () => {
      const actual = runCheck({ id: 'check', type: row.type, params: row.params }, row[status], row.context);
      expect(actual.status).toBe(status);
      expect(CheckResultSchema.safeParse(actual).success).toBe(true);
      const evidence = actual.evidence;
      const points = Array.from(fieldView(row[status], evidence.field));
      if ('quote' in evidence) expect(points.slice(evidence.start, evidence.end).join('')).toBe(evidence.quote);
      else {
        expect(evidence.anchor).toBeGreaterThanOrEqual(0);
        expect(evidence.anchor).toBeLessThanOrEqual(points.length);
        expect(points.slice(Math.max(0, evidence.anchor - 20), evidence.anchor + 20).join('')).toBe(evidence.context);
      }
      expect(actual).toHaveProperty('expected');
      expect(actual).toHaveProperty('observed');
      expect(actual.detail.length).toBeGreaterThan(0);
    });
    it('returns error for invalid params rather than pass/fail', () => {
      const actual = runCheck({ id: 'check', type: row.type, params: { ...row.params, executable_expression: '() => true' } }, row.pass, row.context);
      expect(actual.status).toBe('error');
      expect(CheckResultSchema.safeParse(actual).success).toBe(true);
    });
  });
});

const check = (type: CheckType, params: unknown, value = output(), context?: CheckContext) => runCheck({ id: 'c', type, params }, value, context);
describe('check edge contracts', () => {
  it('uses code-point spans for a narrow match after astral Unicode', () => {
    expect(check('contains', { value: 'needle' }, output({ text: '😀 needle end' })).evidence)
      .toEqual({ field: 'text', start: 2, end: 8, quote: 'needle' });
    expect(check('regex', { pattern: 'needle' }, output({ text: '😀 needle end' })).evidence)
      .toEqual({ field: 'text', start: 2, end: 8, quote: 'needle' });
  });
  it('uses a zero-width anchor for missing content and an empty answer', () => {
    expect(check('contains', { value: 'required' }, output({ text: '' })).evidence)
      .toEqual({ field: 'text', anchor: 0, context: '' });
    expect(check('tool_called', { name: 'search' }).evidence).toHaveProperty('anchor');
  });
  it('supports explicit thinking-field text checks', () => {
    expect(check('equals', { field: 'thinking', value: 'private' }, output({ thinking: 'private' })).status).toBe('pass');
  });
  it('uses inclusive word bounds and empty-string count zero', () => {
    expect(check('length', { min: 2, max: 2, unit: 'words' }, output({ text: 'one\ttwo' })).status).toBe('pass');
    expect(check('length', { min: 0, max: 0, unit: 'words' }, output({ text: '' })).observed).toBe(0);
    expect(check('length', { min: 3, max: 2 }).status).toBe('error');
  });
  it('accepts all four bullet markers without normalising their glyphs', () => {
    expect(check('bullet_count', { min: 4, max: 4 }, output({ text: '- a\n* b\n• c\n1. d' })).status).toBe('pass');
  });
  it('escapes banned words as literal strings and reports the narrow match', () => {
    expect(check('no_banned_words', { words: ['a+b'] }, output({ text: '😀 A+B here' })).evidence)
      .toEqual({ field: 'text', start: 2, end: 5, quote: 'A+B' });
    expect(check('no_banned_words', { words: ['SECRET'], case_sensitive: true }, output({ text: 'secret' })).status).toBe('pass');
  });
  it.each(['(a+)+', '(a|aa)+', '(a*){2}', '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', '(a)\\1', '\\k<name>', 'a'.repeat(201), '['])('abstains on unsafe/invalid pattern %s', (pattern) => {
    expect(regexWarning(pattern)).not.toBeNull();
    expect(check('regex', { pattern }).status).toBe('error');
  });
  it('caps regex target by UTF-8 bytes, not JS length', () => {
    expect(check('regex', { pattern: 'é' }, output({ text: 'é'.repeat(32768) })).status).toBe('pass');
    expect(check('regex', { pattern: 'é' }, output({ text: 'é'.repeat(32769) })).status).toBe('error');
    expect(check('regex', { pattern: 'a', flags: 'g' }).status).toBe('error');
  });
  it('makes invalid and remote JSON schemas errors; malformed output JSON is a fail', () => {
    expect(check('json_schema', { schema: { type: 'no-such-type' } }).status).toBe('error');
    expect(check('json_schema', { schema: { $ref: 'https://example.invalid/schema' } }).status).toBe('error');
    expect(check('json_schema', { schema: { $async: true, type: 'string' } }).status).toBe('error');
    expect(check('json_schema', { schema: true }, output({ text: 'not JSON' })).status).toBe('fail');
    expect(check('json_schema', { schema: { type: 'object', properties: { a: { $ref: '#/$defs/n' } }, $defs: { n: { type: 'number' } } } }, output({ text: '{"a":2}' })).status).toBe('pass');
  });
  it('detects copied thinking at exactly 40 code points, not 39', () => {
    const span = '😀'.repeat(40);
    expect(check('thinking_leak', {}, output({ text: `answer ${span}`, thinking: `private ${span}` })).status).toBe('fail');
    expect(check('thinking_leak', {}, output({ text: '😀'.repeat(39), thinking: span })).status).toBe('pass');
    expect(check('thinking_leak', { expect_thinking: true }).status).toBe('error');
    expect(check('thinking_leak', { expect_thinking: true }, output({ text: '<think>visible' })).status).toBe('fail');
  });
  it('detects copy after newline normalisation and preserves case sensitivity', () => {
    const span = `line one\r\n${'x'.repeat(40)}`;
    expect(check('thinking_leak', {}, output({ text: span, thinking: span })).status).toBe('fail');
    expect(check('thinking_leak', {}, output({ text: 'X'.repeat(40), thinking: 'x'.repeat(40) })).status).toBe('pass');
  });
  it('recognises refusal reason and phrases; unknown without a hit is an error', () => {
    expect(check('refusal', { expected: 'refused' }, output({ stop_reason: 'refusal' })).status).toBe('pass');
    expect(check('refusal', { expected: 'refused' }, output({ text: "I CAN'T HELP you", stop_reason: null })).status).toBe('pass');
    expect(check('refusal', { expected: 'answered' }, output({ stop_reason: null })).status).toBe('error');
    expect(check('stop_reason', { expected: 'end_turn' }, output({ stop_reason: null })).status).toBe('error');
  });
  it.each(['answered', 'refused'] as const)('abstains for a raw unknown stop reason when expecting %s', (expected) => {
    // Bypass normalise to exercise malformed stored output at both public check entrypoints.
    const stored = { text: 'OK answer', thinking: '', tool_calls: [], tool_calls_original: [],
      stop_reason: 'unrecognised_provider_reason', usage: null, latency_ms: null };
    // The cast deliberately supplies invalid external data to the runtime boundary.
    const actual = runCheck({ id: 'c', type: 'refusal', params: { expected } }, stored as NormalisedOutput);
    expect(actual).toMatchObject({ status: 'error', observed: null });
    expect(CheckResultSchema.safeParse(actual).success).toBe(true);
    expect(checks.refusal.evaluate(stored as NormalisedOutput, { expected }, {}))
      .toMatchObject({ status: 'error', expected, observed: null });
  });
  it.each([
    ['end_turn', 'OK answer', 'pass', 'fail'],
    ['refusal', 'OK answer', 'fail', 'pass'],
    [null, 'OK answer', 'error', 'error'],
    [null, "I CAN'T HELP you", 'fail', 'pass'],
    ['end_turn', "I CAN'T HELP you", 'fail', 'pass'],
  ] as const)('preserves refusal judgments for stored reason %s and text %s', (stop_reason, text, answered, refused) => {
    const stored: NormalisedOutput = { text, thinking: '', tool_calls: [], tool_calls_original: [], stop_reason, usage: null, latency_ms: null };
    expect(runCheck({ id: 'c', type: 'refusal', params: { expected: 'answered' } }, stored).status).toBe(answered);
    expect(runCheck({ id: 'c', type: 'refusal', params: { expected: 'refused' } }, stored).status).toBe(refused);
  });
  it('compares canonical tool args and validates every same-name call', () => {
    expect(check('tool_args', { name: 'search', expected: { b: 2, a: 1 } }, output({ tool_calls: [tool('search', { a: 1, b: 2 })] })).status).toBe('pass');
    expect(check('tool_args', { name: 'search', schema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } } }, output({ tool_calls: [tool(), tool('search', {})] })).status).toBe('fail');
    expect(check('tool_args', { name: 'search', expected: {} }).status).toBe('fail');
    expect(check('tool_args', { name: 'search', schema: { $ref: 'https://example.invalid/x' } }).status).toBe('error');
    expect(check('tool_args', { name: 'search', expected: {}, schema: {} }).status).toBe('error');
  });
  it('tool order uses original trace even when independent calls were sorted', () => {
    const value = normalise({ tool_calls: [tool('z'), tool('a'), tool('z')] }, { independent_tool_calls: true });
    expect(value.tool_calls.map((call) => call.name)).toEqual(['a', 'z', 'z']);
    expect(check('tool_order', { names: ['z', 'a', 'z'] }, value).status).toBe('pass');
    expect(check('tool_order', { names: ['a', 'z', 'z'] }, value).status).toBe('fail');
    expect(check('tool_called', { name: 'z', min: 2 }, value).observed).toBe(2);
    expect(check('tool_forbidden', { name: 'z' }, value).observed).toBe(2);
  });
  it('abstains for unavailable cost/latency and unverified live prices', () => {
    expect(check('cost_budget', { max_usd: 1 }, output({ usage: null }), syntheticContext).status).toBe('error');
    expect(check('cost_budget', { max_usd: 1 }).status).toBe('error');
    const unverified = { check_prices: { ...syntheticContext.check_prices!, synthetic: false } };
    expect(check('cost_budget', { max_usd: 1 }, output(), unverified).status).toBe('error');
    expect(check('latency_budget', { max_ms: 1 }, output({ latency_ms: null })).status).toBe('error');
  });
  it('token recount cost-jump contract changes a cost_budget pass to fail', () => {
    // The M4 injector uses this transformation: reported token counts, never mock spend.
    const before = output({ usage: { input_tokens: 100, output_tokens: 100 } });
    const after = { ...before, usage: { input_tokens: 100, output_tokens: 10_000 } };
    expect(measuredCost(before, syntheticContext.check_prices)).toBe(0.0005);
    expect(check('cost_budget', { max_usd: 0.001 }, before, syntheticContext).status).toBe('pass');
    expect(check('cost_budget', { max_usd: 0.001 }, after, syntheticContext).status).toBe('fail');
    expect(check('cost_budget', { max_usd: 0.001 }, before, syntheticContext).detail).toContain('not spend');
  });
  it('accounts separately for reasoning only when explicitly excluded from output tokens', () => {
    const prices = { ...syntheticContext.check_prices!, reasoning_in_output_tokens: false, reasoning_per_mtok: 2 };
    expect(measuredCost(output({ usage: { input_tokens: 100, output_tokens: 100, reasoning_tokens: 100 } }), prices)).toBe(0.0007);
    expect(measuredCost(output(), prices)).toBeNull();
  });
  it('malformed measurement output cannot silently pass a text-only check', () => {
    expect(check('is_json', {}, { ...output({ text: '{}' }), latency_ms: -1 }).status).toBe('error');
  });
});
