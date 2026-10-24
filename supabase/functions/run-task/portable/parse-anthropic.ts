import { object, tokens, accountingBase, parsedBase, stopReason, type ParsedProvider, type ProviderAccounting } from './parse-common.ts';

/** Billing survives malformed answer/tool data; only reported usage is inspected here. */
export function parseAnthropicAccounting(raw: unknown): ProviderAccounting {
  const usage = object(object(raw).usage), accounting = accountingBase();
  const input = tokens(usage.input_tokens), output = tokens(usage.output_tokens);
  if (input !== null && output !== null) accounting.usage = { input_tokens: input, output_tokens: output };
  const cacheWrite = tokens(usage.cache_creation_input_tokens ?? 0), cacheRead = tokens(usage.cache_read_input_tokens ?? 0);
  accounting.billing.cache_write_tokens = cacheWrite ?? 0;
  // No cache-read price exists in the canonical model contract. Unknown modalities fail closed too.
  accounting.billing.unmodelled = cacheWrite === null || cacheRead === null || cacheRead > 0 || Object.entries(usage).some(([key, value]) =>
    !['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].includes(key) && value !== 0 && value !== null);
  return accounting;
}

export function parseAnthropic(raw: unknown): ParsedProvider {
  const response = object(raw), parsed = { ...parsedBase(), ...parseAnthropicAccounting(raw) };
  const texts: string[] = [], thoughts: string[] = [];
  if (Array.isArray(response.content)) for (const value of response.content) {
    const block = object(value);
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    if (block.type === 'thinking' && typeof block.thinking === 'string') thoughts.push(block.thinking);
    if (block.type === 'tool_use') {
      if (typeof block.name !== 'string' || !block.name || block.input === undefined) throw new Error('Malformed tool_use');
      parsed.tool_calls.push({ name: block.name, args: block.input });
    }
  }
  parsed.text = texts.join('\n'); parsed.thinking = thoughts.length ? thoughts.join('\n') : null;
  parsed.stop_reason = stopReason(response.stop_reason);
  return parsed;
}
