import { object, tokens, accountingBase, parsedBase, stopReason, type ParsedProvider, type ProviderAccounting } from './parse-common.ts';

/** Usage extraction never parses tool arguments or relies on a valid answer shape. */
export function parseOpenAIAccounting(raw: unknown): ProviderAccounting {
  const usage = object(object(raw).usage), accounting = accountingBase();
  const input = tokens(usage.prompt_tokens), output = tokens(usage.completion_tokens);
  const details = object(usage.completion_tokens_details);
  const reasoning = details.reasoning_tokens === undefined ? undefined : tokens(details.reasoning_tokens);
  if (input !== null && output !== null && reasoning !== null) accounting.usage = { input_tokens: input, output_tokens: output,
    ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {}) };
  const promptDetails = object(usage.prompt_tokens_details);
  accounting.billing.unmodelled = Object.entries(promptDetails).some(([, value]) => value !== 0 && value !== null) ||
    Object.entries(details).some(([key, value]) => key !== 'reasoning_tokens' && value !== 0 && value !== null) ||
    Object.entries(usage).some(([key, value]) => !['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_tokens_details', 'completion_tokens_details'].includes(key) && value !== 0 && value !== null);
  return accounting;
}

export function parseOpenAI(raw: unknown): ParsedProvider {
  const response = object(raw), parsed = { ...parsedBase(), ...parseOpenAIAccounting(raw) };
  const choice = object(Array.isArray(response.choices) ? response.choices[0] : null), message = object(choice.message);
  const texts: string[] = [], thoughts: string[] = [];
  if (typeof message.content === 'string') texts.push(message.content);
  if (Array.isArray(message.content)) for (const value of message.content) {
    const block = object(value);
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    if ((block.type === 'thinking' || block.type === 'reasoning') && typeof block.text === 'string') thoughts.push(block.text);
  }
  if (typeof message.reasoning_content === 'string') thoughts.push(message.reasoning_content);
  parsed.text = texts.join('\n'); parsed.thinking = thoughts.length ? thoughts.join('\n') : null;
  if (Array.isArray(message.tool_calls)) for (const value of message.tool_calls) {
    const call = object(value), fn = object(call.function);
    if (call.type !== 'function' || typeof fn.name !== 'string' || !fn.name || typeof fn.arguments !== 'string') throw new Error('Malformed tool call');
    parsed.tool_calls.push({ name: fn.name, args: JSON.parse(fn.arguments) as unknown });
  }
  if (message.function_call !== undefined) throw new Error('Legacy function calls unsupported');
  parsed.stop_reason = stopReason(choice.finish_reason);
  return parsed;
}
export const parseOpenai = parseOpenAI;
