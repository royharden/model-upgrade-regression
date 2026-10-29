import { describe, expect, it } from 'vitest';
import { SuiteSchema } from '../../src/core/regressdiff/schema/suite.ts';
import { liveEstimate, verifiedModel } from '../../src/lib/live-estimate.ts';
import type { Model } from '../../supabase/functions/run-task/portable/types.ts';
import models from '../../supabase/functions/run-task/portable/models.json';
const suite = SuiteSchema.parse({ id: 'suite', name: 'Bound', tasks: [{ id: 'task', category: 'format', messages: [{ role: 'user', content: '字' }], tools: [], checks: [{ id: 'check', type: 'contains', params: { value: '字' } }], independent_tool_calls: false }] });
const verified: Model = { id: 'synthetic-test-only', provider: 'openai_compatible', prices: { currency: 'USD', input_per_mtok: 1, output_per_mtok: 2, verified_date: '2026-10-24', synthetic: false }, check_prices: null, max_tokens: 10, reasoning_budget: 0, billing: { reasoning_counts_in_max_tokens: true }, per_message_overhead_bound: 4, sampling_params_supported: [], supports_tools: false };
describe('live estimates and disabled defaults', () => {
  it('leaves every shipped live placeholder disabled and never displays zero as unknown spend', () => {
    for (const model of models.models as Model[]) if (model.provider !== 'mock') expect(verifiedModel(model)).toBe(false);
    expect(liveEstimate(suite, [verified, { ...verified, prices: null }], 3)).toBe(null);
    expect(verifiedModel({ ...verified, id: 'placeholder:any' })).toBe(false);
  });
  it('uses the same request builder/estimator for both sides and all k samples, refusing capability mismatch', () => {
    const one = liveEstimate(suite, [verified, verified], 1);
    expect(one).not.toBe(null); expect(liveEstimate(suite, [verified, verified], 3)).toBeCloseTo((one ?? 0) * 3, 12);
    const tools = { ...suite, tasks: [{ ...suite.tasks[0], tools: [{ name: 'tool', description: 'data only', input_schema: { type: 'object' } }] }] };
    expect(liveEstimate(tools, [verified, verified], 1)).toBe(null);
  });
});
