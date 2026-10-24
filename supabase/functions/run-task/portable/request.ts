import type { Model } from './types.ts';
import { tokens, type ProviderAccounting } from './parse-common.ts';

export interface ProviderTask {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[];
  tools: readonly { name: string; description: string; input_schema: unknown }[];
  independent_tool_calls: boolean;
}
export function capabilityMismatch(model: Model, task: ProviderTask): boolean {
  return model.provider === 'mock' || (task.tools.length > 0 && !model.supports_tools) ||
    (model.provider === 'openai_compatible' && model.reasoning_budget > 0) ||
    (model.provider === 'anthropic' && model.reasoning_budget > 0 && (model.reasoning_budget < 1024 || model.reasoning_budget >= model.max_tokens));
}
export function buildRequest(model: Model, task: ProviderTask): Record<string, unknown> {
  if (capabilityMismatch(model, task)) throw new Error('capability_mismatch');
  if (!Number.isSafeInteger(model.max_tokens) || model.max_tokens <= 0) throw new Error('billing_unknown');
  const sampling = model.sampling_params_supported.includes('temperature') && model.reasoning_budget === 0 ? { temperature: 0 } : {};
  if (model.provider === 'anthropic') return {
    model: model.id, max_tokens: model.max_tokens, ...sampling,
    system: task.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
    messages: task.messages.filter((m) => m.role !== 'system').map((m) => ({ ...m })),
    ...(task.tools.length ? { tools: task.tools.map((tool) => ({ ...tool })) } : {}),
    ...(model.reasoning_budget > 0 ? { thinking: { type: 'enabled', budget_tokens: model.reasoning_budget } } : {}),
  };
  return { model: model.id, max_tokens: model.max_tokens, ...sampling, stream: false,
    messages: task.messages.map((message) => ({ ...message })),
    ...(task.tools.length ? { tools: task.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })) } : {}),
  };
}
/** Return null whenever actual billing cannot be reconstructed from reported usage and frozen prices. */
export function actualCost(model: Model, accounting: ProviderAccounting): number | null {
  const usage = accounting.usage, prices = model.prices;
  if (!usage || !prices || prices.synthetic || !prices.verified_date || accounting.billing.unmodelled) return null;
  if ([usage.input_tokens, usage.output_tokens, accounting.billing.cache_write_tokens].some((value) => tokens(value) === null) ||
    (usage.reasoning_tokens !== undefined && tokens(usage.reasoning_tokens) === null)) return null;
  // A separately billed category requires explicit counts (including zero) and a valid declared rate.
  let reasoningCharge = 0;
  if (prices.reasoning_in_output_tokens === false) {
    const count = tokens(usage.reasoning_tokens), rate = prices.reasoning_per_mtok;
    if (count === null || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) return null;
    reasoningCharge = count * rate;
  } else if (usage.reasoning_tokens !== undefined && usage.reasoning_tokens > 0 && prices.reasoning_in_output_tokens === undefined) return null;
  if (accounting.billing.cache_write_tokens > 0 && prices.cache_write_per_mtok === undefined) return null;
  const amount = (usage.input_tokens * prices.input_per_mtok + usage.output_tokens * prices.output_per_mtok +
    reasoningCharge + accounting.billing.cache_write_tokens * (prices.cache_write_per_mtok ?? 0)) / 1_000_000;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
