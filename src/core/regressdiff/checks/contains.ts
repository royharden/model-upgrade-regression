import { z } from 'zod';
import { matchEvidence } from '../evidence.ts';
import { defineCheck, missing, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ value: z.string().min(1), field: TextFieldSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  const at = output[p.field].indexOf(p.value);
  return result(output, p.field, at >= 0, p.value, at >= 0 ? p.value : null, 'Case-sensitive containment',
    at >= 0 ? matchEvidence(output, p.field, at, p.value) : missing(output, p.field));
});
