import { describe, expect, it } from 'vitest';
import { SuiteSchema, suiteWarnings } from '../../../src/core/regressdiff/schema/suite.ts';
import { RunArgsSchema } from '../../../src/core/regressdiff/schema/manifest.ts';
import { KNOWN_STOP_REASONS, OutputSchema, RecordingLineSchema } from '../../../src/core/regressdiff/schema/output.ts';
import { ModelsSchema } from '../../../src/core/regressdiff/schema/models.ts';
import { PolicySchema } from '../../../src/core/regressdiff/schema/policy.ts';
import { canonical, utf8Bytes } from '../../../src/core/regressdiff/canonical.ts';
import { output } from './helpers.ts';

const task = () => ({ id: 'fmt.json.1', category: 'format', messages: [{ role: 'user', content: 'Say OK' }], tools: [],
  checks: [{ id: 'prefix-1', type: 'starts_with', params: { value: 'OK' } }], independent_tool_calls: false });
const suite = () => ({ id: 'suite-1', name: 'Suite', tasks: [task()] });
describe('strict suite schema boundaries', () => {
  it('accepts exactly 100 tasks and rejects 101', () => {
    const tasks = Array.from({ length: 101 }, (_, index) => ({ ...task(), id: `t-${index}` }));
    expect(SuiteSchema.safeParse({ ...suite(), tasks: tasks.slice(0, 100) }).success).toBe(true);
    expect(SuiteSchema.safeParse({ ...suite(), tasks }).success).toBe(false);
  });
  it('rejects a multibyte task above 8192 canonical UTF-8 bytes despite small JS length', () => {
    const oversized = { ...task(), messages: [{ role: 'user', content: 'é'.repeat(4200) }] };
    expect(canonical(oversized).length).toBeLessThan(8192);
    expect(utf8Bytes(canonical(oversized))).toBeGreaterThan(8192);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [oversized] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), messages: [{ role: 'user', content: 'é'.repeat(1000) }] }] }).success).toBe(true);
  });
  it('accepts exactly 8192 canonical bytes and rejects 8193', () => {
    const base = SuiteSchema.parse({ ...suite(), tasks: [{ ...task(), messages: [{ role: 'user', content: '' }] }] }).tasks[0];
    const free = 8192 - utf8Bytes(canonical(base));
    const sized = { ...base, messages: [{ role: 'user', content: 'a'.repeat(free) }] };
    expect(utf8Bytes(canonical(sized))).toBe(8192);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [sized] }).success).toBe(true);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...sized, messages: [{ role: 'user', content: 'a'.repeat(free + 1) }] }] }).success).toBe(false);
  });
  it('rejects duplicate task and per-task check ids', () => {
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [task(), task()] }).success).toBe(false);
    const item = task();
    item.checks.push(item.checks[0]);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [item] }).success).toBe(false);
  });
  it.each(['bad/id', 'bad:id', 'bad#id', 'space id', '', 'a'.repeat(65), 'é'])('rejects task/check id %s', (id) => {
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), id }] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), checks: [{ ...task().checks[0], id }] }] }).success).toBe(false);
  });
  it('rejects unknown keys at suite, task, message, tool, check and params boundaries', () => {
    expect(SuiteSchema.safeParse({ ...suite(), k: 3 }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), code: 'execute' }] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), messages: [{ role: 'user', content: 'x', code: 'execute' }] }] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), tools: [{ name: 'x', description: 'x', input_schema: {}, execute: 'code' }] }] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), checks: [{ ...task().checks[0], expression: 'true' }] }] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), checks: [{ ...task().checks[0], params: { value: 'OK', expression: 'true' } }] }] }).success).toBe(false);
  });
  it('validates check-type-specific params and unknown types', () => {
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), checks: [{ id: 'x', type: 'starts_with', params: { max_ms: 1 } }] }] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), checks: [{ id: 'x', type: 'execute', params: {} }] }] }).success).toBe(false);
  });
  it('warns about rejected regex and invalid check schemas', () => {
    const parsed = SuiteSchema.parse({ ...suite(), tasks: [{ ...task(), checks: [
      { id: 'regex', type: 'regex', params: { pattern: '(a+)+' } },
      { id: 'json', type: 'json_schema', params: { schema: { type: 'invalid-type' } } },
    ] }] });
    expect(suiteWarnings(parsed).map((warning) => warning.check_id)).toEqual(['regex', 'json']);
  });
  it('rejects remote schema references in checks and tools without loading them', () => {
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), checks: [{ id: 's', type: 'json_schema', params: { schema: { $ref: 'https://example.invalid/schema' } } }] }] }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), tools: [{ name: 'x', description: 'x', input_schema: { properties: { child: { $ref: 'https://example.invalid/x' } } } }] }] }).success).toBe(false);
  });
  it('rejects non-JSON executable values inside schemas', () => {
    expect(SuiteSchema.safeParse({ ...suite(), tasks: [{ ...task(), checks: [{ id: 's', type: 'json_schema', params: { schema: { execute: () => true } } }] }] }).success).toBe(false);
  });
});
describe('other public schemas', () => {
  it.each([1, 3, 5])('accepts k=%i', (k) => {
    expect(RunArgsSchema.safeParse({ k, old_model: 'mock:old', new_model: 'mock:new' }).success).toBe(true);
  });
  it.each([0, 2, 4, 6, -1, 1.5, '3', null])('rejects k=%s without coercion', (k) => {
    expect(RunArgsSchema.safeParse({ k, old_model: 'mock:old', new_model: 'mock:new' }).success).toBe(false);
  });
  it('requires exactly output or recorded error and preserves null unknowns', () => {
    expect(RecordingLineSchema.safeParse({ task_id: 't', sample: 2, output: null, error: 'recorded failure' }).success).toBe(true);
    expect(RecordingLineSchema.safeParse({ task_id: 't', sample: 1, output: output() }).success).toBe(true);
    expect(RecordingLineSchema.safeParse({ task_id: 't', sample: 1, output: null }).success).toBe(false);
    expect(RecordingLineSchema.safeParse({ task_id: 't', sample: 1, output: output(), error: 'also error' }).success).toBe(false);
    expect(OutputSchema.safeParse({ ...output(), usage: { input_tokens: -1, output_tokens: 1 } }).success).toBe(false);
    expect(OutputSchema.parse({ ...output(), usage: null, latency_ms: null, stop_reason: null }).usage).toBeNull();
  });
  it.each(['unrecognised_provider_reason', 'END_TURN', ''])('rejects raw unknown stop reason %s at output and recording boundaries', (stop_reason) => {
    // Construct stored data directly: the normalising helper would turn unknown reasons into null.
    const stored = { text: 'OK answer', thinking: '', tool_calls: [], tool_calls_original: [], stop_reason, usage: null, latency_ms: null };
    expect(OutputSchema.safeParse(stored).success).toBe(false);
    expect(RecordingLineSchema.safeParse({ task_id: 't', sample: 1, output: stored }).success).toBe(false);
  });
  it.each([...KNOWN_STOP_REASONS, null])('preserves recognised/null stop reason %s at output and recording boundaries', (stop_reason) => {
    const stored = { text: 'OK answer', thinking: '', tool_calls: [], tool_calls_original: [], stop_reason, usage: null, latency_ms: null };
    expect(OutputSchema.parse(stored).stop_reason).toBe(stop_reason);
    expect(RecordingLineSchema.parse({ task_id: 't', sample: 1, output: stored }).output?.stop_reason).toBe(stop_reason);
  });
  it('models mirror accepts synthetic mock prices and an unverified live placeholder', () => {
    const model = { id: 'mock:old', provider: 'mock', prices: null,
      check_prices: { currency: 'USD', input_per_mtok: 1, output_per_mtok: 4, verified_date: null, synthetic: true },
      spend_usd_per_call: 0, max_tokens: 1024, reasoning_budget: 0, billing: { reasoning_counts_in_max_tokens: true },
      per_message_overhead_bound: 10, sampling_params_supported: [], supports_tools: true };
    expect(ModelsSchema.safeParse({ version: 'v1', models: [model] }).success).toBe(true);
    expect(ModelsSchema.safeParse({ version: 'v1', models: [model, model] }).success).toBe(false);
    expect(ModelsSchema.safeParse({ version: 'v1', models: [{ ...model, id: 'unconfigured', provider: 'anthropic', check_prices: null }] }).success).toBe(true);
    // Loading the real portable/models.json is added with that canonical M2 file.
  });
  it('policy refuses negative caps and unknown fields', () => {
    const policy = { max_regressions: 0, always_blocking: ['tool_forbidden', 'tool_order'], cost_cap: { per_task_median: null, suite_total: null },
      latency_cap: { per_task_median: null, suite_total: 1000 }, allow_waive_blocking: false, block_preexisting_hazards: false };
    expect(PolicySchema.safeParse(policy).success).toBe(true);
    expect(PolicySchema.safeParse({ ...policy, max_regressions: -1 }).success).toBe(false);
    expect(PolicySchema.safeParse({ ...policy, execute: 'true' }).success).toBe(false);
  });
});
