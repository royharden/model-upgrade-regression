import { describe, expect, it } from 'vitest';
import anthropic from './fixtures/anthropic.json';
import openai from './fixtures/openai.json';
import { parseAnthropic } from '../../supabase/functions/run-task/portable/parse-anthropic.ts';
import { parseOpenAI, parseOpenAIAccounting } from '../../supabase/functions/run-task/portable/parse-openai.ts';
import { actualCost, buildRequest, capabilityMismatch } from '../../supabase/functions/run-task/portable/request.ts';
import { estimateSpend } from '../../supabase/functions/run-task/portable/estimate.ts';
import { normalise } from '../../src/core/regressdiff/normalise.ts';
import { liveModel } from './fakes.ts';

describe('synthetic portable provider fixtures (authored, not executed)', () => {
  it('separates typed thinking, preserves tool data, and drops provider ids only in canonical normalization', () => {
    for (const parsed of [parseAnthropic(anthropic), parseOpenAI(openai)]) {
      expect(parsed.thinking).toBe('private synthetic rationale'); expect(parsed.text).not.toContain('rationale');
      expect(parsed.tool_calls).toEqual([{ name: 'lookup', args: { z: 2, a: 1 } }]);
      const output = normalise(parsed, { independent_tool_calls: false });
      expect(output.tool_calls_original).toEqual([{ name: 'lookup', args: { a: 1, z: 2 } }]);
      expect(output.text).toBe('OK');
    }
  });
  it('unknown stop reasons and absent or malformed usage stay null, never zero', () => {
    expect(parseAnthropic({ content: [], stop_reason: 'new-provider-reason' })).toMatchObject({ stop_reason: null, usage: null, thinking: null });
    expect(parseOpenAI({ choices: [{ message: {}, finish_reason: 'unknown' }], usage: { prompt_tokens: -1, completion_tokens: 3 } })).toMatchObject({ stop_reason: null, usage: null });
    expect(parseOpenAI({ choices: [], usage: { prompt_tokens: 2.5, completion_tokens: 3 } }).usage).toBeNull();
  });
  it('rejects malformed tool arguments instead of making them executable or fabricated evidence', () => {
    const fixture = structuredClone(openai); fixture.choices[0].message.tool_calls[0].function.arguments = 'not-json';
    expect(() => parseOpenAI(fixture)).toThrow();
    expect(() => parseAnthropic({ content: [{ type: 'tool_use', name: 'lookup' }] })).toThrow();
  });
  it('fails actual billing closed for undeclared cache/special/reasoning usage', () => {
    expect(actualCost(liveModel, parseAnthropic(anthropic))).toBe(0.00009);
    expect(actualCost(liveModel, parseOpenAI(openai))).toBeNull();
    expect(actualCost({ ...liveModel, prices: { ...liveModel.prices!, reasoning_in_output_tokens: true } }, parseOpenAI(openai))).toBe(0.00009);
    expect(actualCost(liveModel, parseAnthropic({ ...anthropic, usage: { ...anthropic.usage, cache_creation_input_tokens: 2 } }))).toBeNull();
    expect(actualCost({ ...liveModel, prices: { ...liveModel.prices!, cache_write_per_mtok: 3 } }, parseAnthropic({ ...anthropic, usage: { ...anthropic.usage, cache_creation_input_tokens: 2 } }))).toBe(0.000096);
    expect(actualCost(liveModel, parseAnthropic({ ...anthropic, usage: { ...anthropic.usage, cache_read_input_tokens: 2 } }))).toBeNull();
    expect(actualCost(liveModel, parseOpenAI({ ...openai, usage: { prompt_tokens: 1, completion_tokens: 1, audio_tokens: 5 } }))).toBeNull();
  });
  it('requires an explicit valid separate reasoning count and declared rate, including for a reported zero', () => {
    const separate = { ...liveModel, prices: { ...liveModel.prices!, reasoning_in_output_tokens: false, reasoning_per_mtok: 2 } };
    const accounting = (reasoning_tokens: unknown) => parseOpenAIAccounting({ usage: { prompt_tokens: 10, completion_tokens: 2,
      completion_tokens_details: reasoning_tokens === undefined ? {} : { reasoning_tokens } } });
    for (const missingOrInvalid of [undefined, null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '0']) {
      expect(actualCost(separate, accounting(missingOrInvalid))).toBeNull();
    }
    expect(actualCost(separate, accounting(0))).toBe(0.000018);
    expect(actualCost(separate, accounting(3))).toBe(0.000024);
    for (const missingOrInvalidRate of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(actualCost({ ...separate, prices: { ...separate.prices, reasoning_per_mtok: missingOrInvalidRate } }, accounting(0))).toBeNull();
    }
    expect(actualCost({ ...separate, prices: { ...separate.prices, reasoning_per_mtok: 0 } }, accounting(3))).toBe(0.000018);
  });
});
describe('bounded provider requests', () => {
  const task = { messages: [{ role: 'system' as const, content: 'Rules' }, { role: 'user' as const, content: 'Question 😀' }],
    tools: [{ name: 'lookup', description: 'Data only', input_schema: { type: 'object' } }], independent_tool_calls: false };
  it('sends max_tokens, system and tools; sends only declared sampling parameters', () => {
    const request = buildRequest(liveModel, task);
    expect(request).toMatchObject({ max_tokens: 1000, temperature: 0, system: 'Rules', tools: task.tools });
    expect(request).not.toHaveProperty('seed'); expect(request).not.toHaveProperty('top_p');
    expect(buildRequest({ ...liveModel, sampling_params_supported: [] }, task)).not.toHaveProperty('temperature');
    expect(buildRequest({ ...liveModel, provider: 'openai_compatible' }, task)).toMatchObject({ stream: false, tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }] });
  });
  it('refuses undeclared tool/reasoning capability', () => {
    expect(capabilityMismatch({ ...liveModel, supports_tools: false }, task)).toBe(true);
    expect(() => buildRequest({ ...liveModel, provider: 'mock' }, task)).toThrow('capability_mismatch');
    expect(capabilityMismatch({ ...liveModel, provider: 'openai_compatible', reasoning_budget: 100 }, task)).toBe(true);
  });
  it('reservation uses serialized tool schemas plus UTF-8 bytes and highest declared input rate', () => {
    const request = JSON.stringify(buildRequest(liveModel, task));
    const bound = estimateSpend({ ...liveModel, prices: { ...liveModel.prices!, cache_write_per_mtok: 3 } }, { serialized_request: request, message_count: task.messages.length });
    expect(bound.status).toBe('known');
    if (bound.status === 'known') {
      expect(bound.input_tokens_bound).toBe(new TextEncoder().encode(request).length + task.messages.length * 20);
      expect(bound.usd).toBe((bound.input_tokens_bound * 3 + 1000 * 4) / 1_000_000);
    }
    expect(estimateSpend({ ...liveModel, prices: null }, { serialized_request: request, message_count: 2 }).status).toBe('unavailable');
  });
  it('refuses a separately billed reasoning configuration without a valid rate before reserving', () => {
    const input = { serialized_request: '{}', message_count: 1 };
    for (const reasoning_per_mtok of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estimateSpend({ ...liveModel, prices: { ...liveModel.prices!, reasoning_in_output_tokens: false, reasoning_per_mtok } }, input))
        .toEqual({ status: 'unavailable', reason: 'reasoning billing rate unavailable' });
    }
    expect(estimateSpend({ ...liveModel, prices: { ...liveModel.prices!, reasoning_in_output_tokens: false, reasoning_per_mtok: 0 } }, input).status).toBe('known');
  });
});
