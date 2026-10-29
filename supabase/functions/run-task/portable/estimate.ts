import type { EstimateInput, Model, SpendEstimate } from './types.ts';

function bytes(text: string): number {
  let count = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    count += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
  }
  return count;
}
const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
export function estimateSpend(model: Model, request: EstimateInput): SpendEstimate {
  if (model.provider === 'mock') {
    return model.spend_usd_per_call === 0
      ? { status: 'known', usd: 0, input_tokens_bound: 0, output_tokens_bound: 0, label: 'USD 0.00 (mock spend)' }
      : { status: 'unavailable', reason: 'Mock spend configuration is invalid' };
  }
  const prices = model.prices;
  if (!prices || prices.synthetic || typeof prices.verified_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(prices.verified_date)) return { status: 'unavailable', reason: 'no verified model prices' };
  if (prices.currency !== 'USD' || !nonnegative(prices.input_per_mtok) || !nonnegative(prices.output_per_mtok) ||
    !Number.isInteger(model.max_tokens) || model.max_tokens <= 0 || !Number.isInteger(model.reasoning_budget) || model.reasoning_budget < 0 ||
    !Number.isInteger(model.per_message_overhead_bound) || model.per_message_overhead_bound < 0 ||
    !Number.isInteger(request.message_count) || request.message_count < 0 || typeof request.serialized_request !== 'string' ||
    typeof model.billing?.reasoning_counts_in_max_tokens !== 'boolean') return { status: 'unavailable', reason: 'billing bounds unavailable' };
  const inputRates = [prices.input_per_mtok, prices.cache_write_per_mtok, prices.special_input_per_mtok].filter((rate): rate is number => rate !== undefined);
  if (!inputRates.every(nonnegative)) return { status: 'unavailable', reason: 'input billing rate unavailable' };
  const input = bytes(request.serialized_request) + request.message_count * model.per_message_overhead_bound;
  const output = model.max_tokens + (model.billing.reasoning_counts_in_max_tokens ? 0 : model.reasoning_budget);
  // Separately billed reasoning must be bounded too. Use the highest output-side rate conservatively.
  if (prices.reasoning_in_output_tokens === false && prices.reasoning_per_mtok === undefined) return { status: 'unavailable', reason: 'reasoning billing rate unavailable' };
  if (prices.reasoning_per_mtok !== undefined && !nonnegative(prices.reasoning_per_mtok)) return { status: 'unavailable', reason: 'reasoning billing rate unavailable' };
  const usd = (input * Math.max(...inputRates) + output * Math.max(prices.output_per_mtok, prices.reasoning_per_mtok ?? 0)) / 1_000_000;
  return Number.isFinite(usd)
    ? { status: 'known', usd, input_tokens_bound: input, output_tokens_bound: output, label: 'USD reservation upper bound (verified prices)' }
    : { status: 'unavailable', reason: 'nonfinite estimate' };
}
