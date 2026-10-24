import { canonical } from './canonical.ts';
import { JsonValueSchema, KNOWN_STOP_REASONS, OutputSchema, type NormalisedOutput, type ToolCall } from './schema/output.ts';

export const NORMALISATION_VERSION = 'normalisation-v1';
export interface NormalisationInput {
  text?: string;
  thinking?: string | null;
  /** Provider adapters separate typed thinking blocks; literal tags in text remain detectable leaks. */
  blocks?: readonly { type: 'text' | 'thinking'; text: string }[];
  tool_calls?: readonly { name: string; args: unknown; id?: string }[];
  tool_calls_original?: readonly { name: string; args: unknown; id?: string }[];
  stop_reason?: string | null;
  usage?: NormalisedOutput['usage'];
  latency_ms?: number | null;
}
export function normaliseLines(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[^\S\n]+$/u, '')).join('\n').trimEnd();
}
function tool(call: { name: string; args: unknown }): ToolCall {
  // A string argument is a provider JSON encoding, not a string-valued argument object.
  const args: unknown = typeof call.args === 'string' ? JSON.parse(call.args) : call.args;
  return { name: call.name, args: JSON.parse(canonical(JsonValueSchema.parse(args))) as ToolCall['args'] };
}
export function normalise(input: NormalisationInput, task: { independent_tool_calls: boolean }): NormalisedOutput {
  const blocks = input.blocks;
  let text = normaliseLines(blocks ? blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : input.text ?? '');
  const thinking = normaliseLines(blocks ? blocks.filter((b) => b.type === 'thinking').map((b) => b.text).join('\n') : input.thinking ?? '');
  try { text = canonical(JSON.parse(text)); } catch { /* Prose is intentionally preserved. */ }
  const original = (input.tool_calls_original ?? input.tool_calls ?? []).map(tool);
  const calls = original.map((call) => ({ ...call }));
  if (task.independent_tool_calls) {
    calls.sort((a, b) => {
      const left = `${a.name}\u0000${canonical(a.args)}`;
      const right = `${b.name}\u0000${canonical(b.args)}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  return OutputSchema.parse({
    text, thinking, tool_calls: calls, tool_calls_original: original,
    stop_reason: input.stop_reason && (KNOWN_STOP_REASONS as readonly string[]).includes(input.stop_reason) ? input.stop_reason : null,
    usage: input.usage ?? null, latency_ms: input.latency_ms ?? null,
  });
}
export const normalize = normalise;
