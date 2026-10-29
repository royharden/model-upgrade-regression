/** Canonical provider/model contracts. Dependency-free: browser, CLI and edge share this file. */
export type Provider = 'mock' | 'anthropic' | 'openai_compatible';
export interface Prices {
  currency: 'USD'; input_per_mtok: number; output_per_mtok: number;
  verified_date: string | null; synthetic: boolean;
  reasoning_per_mtok?: number; reasoning_in_output_tokens?: boolean;
  cache_write_per_mtok?: number; special_input_per_mtok?: number;
}
export interface Model {
  id: string; provider: Provider; prices: Prices | null; check_prices: Prices | null;
  spend_usd_per_call?: number; max_tokens: number; reasoning_budget: number;
  billing: { reasoning_counts_in_max_tokens: boolean };
  per_message_overhead_bound: number; sampling_params_supported: ('temperature' | 'top_p' | 'seed')[];
  supports_tools: boolean;
}
export interface Models { version: string; models: Model[] }
export interface EstimateInput { serialized_request: string; message_count: number }
export type SpendEstimate =
  | { status: 'known'; usd: number; input_tokens_bound: number; output_tokens_bound: number; label: string }
  | { status: 'unavailable'; reason: string };
