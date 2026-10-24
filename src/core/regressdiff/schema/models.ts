import { z } from 'zod';

export const PriceSchema = z.object({
  currency: z.literal('USD'), input_per_mtok: z.number().finite().nonnegative(), output_per_mtok: z.number().finite().nonnegative(),
  verified_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), synthetic: z.boolean(),
  reasoning_per_mtok: z.number().finite().nonnegative().optional(), reasoning_in_output_tokens: z.boolean().optional(),
  cache_write_per_mtok: z.number().finite().nonnegative().optional(), special_input_per_mtok: z.number().finite().nonnegative().optional(),
}).strict();
/** Dependency-free portable/types.ts becomes the canonical mirror contract in M2. */
export const ModelSchema = z.object({
  id: z.string().min(1), provider: z.enum(['mock', 'anthropic', 'openai_compatible']),
  prices: PriceSchema.nullable(), check_prices: PriceSchema.nullable(), spend_usd_per_call: z.number().finite().nonnegative().optional(),
  max_tokens: z.number().int().positive(), reasoning_budget: z.number().int().nonnegative(),
  billing: z.object({ reasoning_counts_in_max_tokens: z.boolean() }).strict(),
  per_message_overhead_bound: z.number().int().nonnegative(), sampling_params_supported: z.array(z.enum(['temperature', 'top_p', 'seed'])),
  supports_tools: z.boolean(),
}).strict();
export const ModelsSchema = z.object({ version: z.string().min(1), models: z.array(ModelSchema).min(1) }).strict()
  .refine((config) => new Set(config.models.map((model) => model.id)).size === config.models.length, 'Duplicate model ids');
export type Model = z.infer<typeof ModelSchema>;
export type Models = z.infer<typeof ModelsSchema>;
