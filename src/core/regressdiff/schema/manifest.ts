import { z } from 'zod';
import { ModelSchema } from './models.ts';
import { IdSchema } from './suite.ts';

export const KSchema = z.union([z.literal(1), z.literal(3), z.literal(5)]);
/** Defaults belong to the caller: CLI mock=1; demo UI/live=3. Never coerce k=2. */
export const RunArgsSchema = z.object({ k: KSchema, old_model: z.string().min(1), new_model: z.string().min(1) }).strict();
export type RunArgs = z.infer<typeof RunArgsSchema>;
export const RunManifestSchema = z.object({
  run_id: IdSchema, suite_sha256: z.string().regex(/^[a-f0-9]{64}$/), models_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  k: KSchema, mode: z.enum(['demo', 'live']), old_model: ModelSchema, new_model: ModelSchema,
  normalisation_version: z.string().min(1), canonical_version: z.string().min(1), verdict_rule_version: z.string().min(1),
  seed: z.number().int().nonnegative(),
}).strict();
export type RunManifest = z.infer<typeof RunManifestSchema>;
