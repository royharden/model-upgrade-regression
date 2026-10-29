import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import modelsJson from '../../../supabase/functions/run-task/portable/models.json';
import { ModelsSchema } from '../../../src/core/regressdiff/schema/models.ts';
import { estimateSpend } from '../../../supabase/functions/run-task/portable/estimate.ts';
import type { Model, Models } from '../../../supabase/functions/run-task/portable/types.ts';

// This assignment and its reverse are compile-time checks of the canonical portable/Zod contract.
const parsed = ModelsSchema.parse(modelsJson);
const canonicalModels: Models = parsed;
const mirror: z.infer<typeof ModelsSchema> = canonicalModels;
describe('portable model source of truth and Zod mirror', () => {
  it('validates actual models.json and keeps live placeholders unpriced', () => {
    expect(mirror.models).toHaveLength(4);
    expect(mirror.models.filter((model) => model.provider === 'mock').every((model) => model.spend_usd_per_call === 0 && model.check_prices?.synthetic)).toBe(true);
    expect(mirror.models.filter((model) => model.provider !== 'mock').every((model) => model.prices === null && model.check_prices === null)).toBe(true);
    expect(ModelsSchema.safeParse(canonicalModels).success).toBe(true);
  });
  it('separates zero mock spend from nonzero synthetic check prices', () => {
    const mock = canonicalModels.models[0];
    expect(estimateSpend(mock, { serialized_request: '', message_count: 0 })).toMatchObject({ status: 'known', usd: 0 });
    expect(mock.check_prices?.output_per_mtok).toBe(4);
  });
  it('fails closed for live placeholders', () => {
    for (const model of canonicalModels.models.filter((model) => model.provider !== 'mock')) {
      expect(estimateSpend(model, { serialized_request: 'request', message_count: 1 })).toEqual({ status: 'unavailable', reason: 'no verified model prices' });
    }
  });
});
describe('portable reservation bound', () => {
  const live: Model = { ...canonicalModels.models[0], provider: 'anthropic', prices: {
    currency: 'USD', input_per_mtok: 1, output_per_mtok: 4, cache_write_per_mtok: 3, special_input_per_mtok: 2,
    verified_date: '2026-10-24', synthetic: false,
  }, max_tokens: 10, reasoning_budget: 5, billing: { reasoning_counts_in_max_tokens: false }, per_message_overhead_bound: 7 };
  it('bounds inputs by UTF-8 bytes plus overhead and uses highest rates', () => {
    const result = estimateSpend(live, { serialized_request: '😀é', message_count: 2 });
    // 6 UTF-8 bytes + 2*7 overhead = 20 input; 10+5 = 15 output; (20*3 + 15*4)/1e6.
    expect(result).toMatchObject({ status: 'known', input_tokens_bound: 20, output_tokens_bound: 15, usd: 0.00012 });
  });
  it('counts included reasoning once, and rejects missing/invalid bounds', () => {
    expect(estimateSpend({ ...live, billing: { reasoning_counts_in_max_tokens: true } }, { serialized_request: '', message_count: 0 })).toMatchObject({ output_tokens_bound: 10 });
    expect(estimateSpend({ ...live, max_tokens: 0 }, { serialized_request: '', message_count: 1 }).status).toBe('unavailable');
    expect(estimateSpend(live, { serialized_request: '', message_count: -1 }).status).toBe('unavailable');
    expect(estimateSpend({ ...live, prices: { ...live.prices!, cache_write_per_mtok: -1 } }, { serialized_request: '', message_count: 1 }).status).toBe('unavailable');
    expect(estimateSpend({ ...live, prices: { ...live.prices!, verified_date: null } }, { serialized_request: '', message_count: 1 }).status).toBe('unavailable');
  });
});
