import { z } from 'zod';
import { CHECK_TYPES, type CheckType } from '../checks/index.ts';

const CapSchema = z.object({ per_task_median: z.number().finite().nonnegative().nullable(), suite_total: z.number().finite().nonnegative().nullable() }).strict();
export const PolicySchema = z.object({
  max_regressions: z.number().int().nonnegative(), always_blocking: z.array(z.enum(CHECK_TYPES as [CheckType, ...CheckType[]])),
  cost_cap: CapSchema, latency_cap: CapSchema, allow_waive_blocking: z.boolean(), block_preexisting_hazards: z.boolean(),
}).strict();
export type Policy = z.infer<typeof PolicySchema>;
