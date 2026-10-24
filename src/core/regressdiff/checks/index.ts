import { OutputSchema, type NormalisedOutput } from '../schema/output.ts';
import type { CheckResult, EvidenceField } from '../evidence.ts';
import { errorResult, type CheckContext } from './shared.ts';
import equals from './equals.ts';
import contains from './contains.ts';
import regex from './regex.ts';
import is_json from './is_json.ts';
import json_schema from './json_schema.ts';
import length from './length.ts';
import starts_with from './starts_with.ts';
import bullet_count from './bullet_count.ts';
import no_banned_words from './no_banned_words.ts';
import thinking_leak from './thinking_leak.ts';
import refusal from './refusal.ts';
import stop_reason from './stop_reason.ts';
import tool_called from './tool_called.ts';
import tool_args from './tool_args.ts';
import tool_order from './tool_order.ts';
import tool_forbidden from './tool_forbidden.ts';
import cost_budget from './cost_budget.ts';
import latency_budget from './latency_budget.ts';

export const checks = { equals, contains, regex, is_json, json_schema, length, starts_with, bullet_count,
  no_banned_words, thinking_leak, refusal, stop_reason, tool_called, tool_args, tool_order, tool_forbidden, cost_budget, latency_budget } as const;
export const CHECK_TYPES = Object.keys(checks) as (keyof typeof checks)[];
export type CheckType = keyof typeof checks;
export interface CheckConfig { id: string; type: CheckType; params: unknown }
export function runCheck(check: CheckConfig, output: NormalisedOutput, context: CheckContext = {}): CheckResult {
  const field: EvidenceField = check.type.startsWith('tool_') ? (check.type === 'tool_order' ? 'tool_calls_original' : 'tool_calls')
    : check.type === 'cost_budget' ? 'usage' : check.type === 'latency_budget' ? 'latency_ms' : check.type === 'stop_reason' ? 'stop_reason' : 'text';
  try {
    const valid = OutputSchema.parse(output);
    const definition = checks[check.type];
    if (!definition) return errorResult(valid, field, 'Unknown check type');
    return definition.evaluate(valid, check.params, context);
  } catch (error) {
    // Malformed output is not a normal engine input, but the public boundary still abstains.
    const safe = OutputSchema.safeParse(output);
    const fallback: NormalisedOutput = safe.success ? safe.data : { text: '', thinking: '', tool_calls: [], tool_calls_original: [], stop_reason: null, usage: null, latency_ms: null };
    return errorResult(fallback, field, error instanceof Error ? error.message : 'Check could not be evaluated');
  }
}
export type { CheckContext, CheckPrices } from './shared.ts';
