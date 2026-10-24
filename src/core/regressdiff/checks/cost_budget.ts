import { z } from 'zod';
import { BoundSchema, defineCheck, errorResult, result, type CheckPrices } from './shared.ts';
import type { NormalisedOutput } from '../schema/output.ts';
export const paramsSchema = z.object({ max_usd: BoundSchema }).strict();
export function measuredCost(output: NormalisedOutput, prices?: CheckPrices | null): number | null {
  if (!output.usage || !prices || prices.currency !== 'USD' || (!prices.synthetic && !prices.verified_date)) return null;
  if (![prices.input_per_mtok, prices.output_per_mtok].every((n) => Number.isFinite(n) && n >= 0)) return null;
  const usage = output.usage;
  let cost = (usage.input_tokens * prices.input_per_mtok + usage.output_tokens * prices.output_per_mtok) / 1_000_000;
  if (prices.reasoning_in_output_tokens === false) {
    if (usage.reasoning_tokens === undefined || prices.reasoning_per_mtok === undefined || !Number.isFinite(prices.reasoning_per_mtok) || prices.reasoning_per_mtok < 0) return null;
    cost += usage.reasoning_tokens * prices.reasoning_per_mtok / 1_000_000;
  }
  return Number.isFinite(cost) ? cost : null;
}
export default defineCheck(paramsSchema, (output, p, context) => {
  const cost = measuredCost(output, context.check_prices);
  if (cost === null) return errorResult(output, 'usage', 'Usage or verified/synthetic check prices unavailable', p.max_usd);
  return result(output, 'usage', cost <= p.max_usd, p.max_usd, cost,
    context.check_prices?.synthetic ? 'USD: synthetic check price, not spend' : 'USD: verified check price');
});
