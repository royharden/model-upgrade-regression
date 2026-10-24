import { normalise, type NormalisationInput } from '../../../src/core/regressdiff/normalise.ts';
import type { NormalisedOutput } from '../../../src/core/regressdiff/schema/output.ts';
import type { CheckContext } from '../../../src/core/regressdiff/checks/index.ts';

export function output(input: NormalisationInput = {}): NormalisedOutput {
  return normalise({ text: 'OK answer', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 }, latency_ms: 100, ...input },
    { independent_tool_calls: false });
}
export const syntheticContext: CheckContext = { check_prices: {
  currency: 'USD', input_per_mtok: 1, output_per_mtok: 4, verified_date: null, synthetic: true,
} };
