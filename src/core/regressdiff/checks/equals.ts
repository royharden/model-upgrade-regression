import { z } from 'zod';
import { defineCheck, missing, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ value: z.string(), field: TextFieldSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => result(output, p.field, output[p.field] === p.value,
  p.value, output[p.field], 'Exact case-sensitive equality', output[p.field] === '' && p.value !== '' ? missing(output, p.field) : undefined));
