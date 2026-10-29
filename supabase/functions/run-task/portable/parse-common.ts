/** Provider JSON is untrusted data; these helpers have no runtime or network dependencies. */
export type JsonRecord = Record<string, unknown>;
export const object = (value: unknown): JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
export const tokens = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
export interface ReportedUsage {
  input_tokens: number; output_tokens: number; reasoning_tokens?: number;
}
export interface ProviderAccounting {
  usage: ReportedUsage | null;
  /** Cache/special billing that the canonical token fields alone cannot represent. */
  billing: { cache_write_tokens: number; unmodelled: boolean };
}
export interface ParsedProvider extends ProviderAccounting {
  text: string; thinking: string | null; tool_calls: { name: string; args: unknown }[];
  stop_reason: string | null;
}
export function accountingBase(): ProviderAccounting {
  return { usage: null, billing: { cache_write_tokens: 0, unmodelled: false } };
}
export function parsedBase(): ParsedProvider {
  return { text: '', thinking: null, tool_calls: [], stop_reason: null, ...accountingBase() };
}
export const stopReason = (value: unknown): string | null => typeof value === 'string' && ['end_turn', 'max_tokens', 'tool_use', 'refusal', 'stop_sequence', 'stop', 'length', 'tool_calls', 'content_filter'].includes(value) ? value : null;
