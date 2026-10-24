import { z } from 'zod';
import { BoundSchema, defineCheck, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ min: BoundSchema.int().optional(), max: BoundSchema.int().optional(),
  unit: z.enum(['chars', 'words']).default('chars'), field: TextFieldSchema,
}).strict().refine((p) => p.min !== undefined || p.max !== undefined, 'A bound is required')
  .refine((p) => p.min === undefined || p.max === undefined || p.min <= p.max, 'min must not exceed max');
export default defineCheck(paramsSchema, (output, p) => {
  const value = output[p.field];
  const count = p.unit === 'chars' ? Array.from(value).length : value.trim() === '' ? 0 : value.trim().split(/\s+/u).length;
  return result(output, p.field, count >= (p.min ?? 0) && count <= (p.max ?? Infinity),
    { min: p.min ?? null, max: p.max ?? null, unit: p.unit }, count, 'Inclusive length bounds');
});
