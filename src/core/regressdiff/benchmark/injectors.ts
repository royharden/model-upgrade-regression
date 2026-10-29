import { canonical } from '../canonical.ts';
import type { CheckConfig } from '../checks/index.ts';
import type { JsonValue } from '../canonical.ts';
import type { NormalisedOutput } from '../schema/output.ts';
import type { Task } from '../schema/suite.ts';
import type { InjectorClass } from './types.ts';

/** Synthetic lexical tokeniser; this is a recount of the generated text, not a provider bill. */
export const TOKEN_RECOUNT_ALGORITHM = 'synthetic-unicode-words-and-punctuation-v1';
export function recountOutputTokens(text: string): number {
  return text.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)?.length ?? 0;
}
export function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const params = (check: CheckConfig): Record<string, unknown> => check.params as Record<string, unknown>;
const object = (value: unknown): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function expectedCheck(task: Task, className: InjectorClass): CheckConfig | null {
  const type = { thinking_leak: 'thinking_leak', refusal_appears: 'refusal', tool_argument_changed: 'tool_args',
    required_field_dropped: 'json_schema', length_bound_passed: 'length', token_recount_cost_jump: 'cost_budget',
    latency_jump: 'latency_budget', forbidden_tool_call: 'tool_forbidden', wrong_stop_reason: 'stop_reason' } as const;
  if (className === 'lost_fact') {
    return task.checks.find((check) => check.type === 'contains' && (task.required_facts ?? []).includes(String(params(check).value))) ?? null;
  }
  return task.checks.find((check) => check.type === type[className] &&
    (className !== 'refusal_appears' || params(check).expected === 'answered') &&
    (className !== 'length_bound_passed' || typeof params(check).max === 'number') &&
    (className !== 'required_field_dropped' || (object(params(check).schema) && Array.isArray((params(check).schema as Record<string, unknown>).required)))) ?? null;
}

export function canInject(task: Task, output: NormalisedOutput, className: InjectorClass): boolean {
  if (className === 'lost_fact') return task.category === 'semantic' && (task.required_facts?.length ?? 0) > 0;
  const check = expectedCheck(task, className);
  if (!check) return false;
  const p = params(check);
  if (className === 'token_recount_cost_jump') return output.usage !== null && Number(p.max_usd) < 1;
  if (className === 'latency_jump') return output.latency_ms !== null;
  if (className === 'required_field_dropped') {
    try { const value: unknown = JSON.parse(output.text); return object(value) && Array.isArray((p.schema as Record<string, unknown>).required); }
    catch { return false; }
  }
  if (className === 'tool_argument_changed') return output.tool_calls_original.some((call) => call.name === p.name);
  return true;
}

/** Each invocation changes one intended dimension in a clone; tools remain inert recorded proposals. */
export function inject(className: InjectorClass, task: Task, source: NormalisedOutput, nonce = 0): NormalisedOutput {
  if (!canInject(task, source, className)) throw new Error(`Unsupported ${className} task ${task.id}`);
  const next = cloneJson(source), check = expectedCheck(task, className), p = check ? params(check) : {};
  switch (className) {
    case 'thinking_leak':
      next.text += `\n<thinking>Private synthetic reasoning ${nonce}</thinking>`;
      break;
    case 'refusal_appears':
      next.text = `I cannot help with that request. Synthetic refusal ${nonce}.`;
      next.stop_reason = 'refusal';
      break;
    case 'tool_argument_changed': {
      const mutate = (args: JsonValue): JsonValue => {
        if (object(args)) {
          const keys = Object.keys(args).sort();
          const key = keys[0] ?? 'benchmark_changed';
          return { ...args, [key]: typeof args[key] === 'number' ? Number(args[key]) + 1 + nonce : null };
        }
        return { benchmark_changed: nonce };
      };
      next.tool_calls_original = next.tool_calls_original.map((call) => call.name === p.name ? { ...call, args: mutate(call.args) } : call);
      next.tool_calls = cloneJson(next.tool_calls_original);
      break;
    }
    case 'required_field_dropped': {
      const value = JSON.parse(next.text) as Record<string, JsonValue>;
      const required = (p.schema as Record<string, unknown>).required as string[];
      delete value[required[nonce % required.length]];
      next.text = canonical(value);
      break;
    }
    case 'length_bound_passed':
      next.text = p.unit === 'words' ? Array.from({ length: Number(p.max) + 1 + nonce % 7 }, () => 'overflow').join(' ')
        : 'x'.repeat(Number(p.max) + 1 + nonce % 31);
      break;
    case 'token_recount_cost_jump': {
      // At synthetic $4/M output tokens this text alone exceeds max_usd, even with zero input cost.
      const count = Math.ceil(Number(p.max_usd) * 1_000_000 / 4) + 25 + nonce % 97;
      next.text = Array.from({ length: count }, (_, index) => `token${index}`).join(' ');
      next.usage = { ...next.usage!, output_tokens: recountOutputTokens(next.text) };
      break;
    }
    case 'latency_jump':
      next.latency_ms = Number(p.max_ms) + 1 + nonce % 1000;
      break;
    case 'forbidden_tool_call':
      next.tool_calls_original.push({ name: String(p.name), args: { synthetic: true, nonce } });
      next.tool_calls = cloneJson(next.tool_calls_original);
      break;
    case 'wrong_stop_reason':
      next.stop_reason = p.expected === 'max_tokens' ? 'end_turn' : 'max_tokens';
      break;
    case 'lost_fact':
      // No original fact tokens survive. Undeclared factual checks remain an explicit expected miss.
      // Keep numeric seed digits out: they could accidentally retain a required numeric fact such as "12".
      next.text = `An unrelated synthetic statement${'!'.repeat(1 + nonce % 7)}`;
      break;
  }
  return next;
}
