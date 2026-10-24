import { z } from 'zod';
import { spanEvidence } from '../evidence.ts';
import { defineCheck, missing, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ value: z.string().min(1), field: TextFieldSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => result(output, p.field, output[p.field].startsWith(p.value), p.value,
  Array.from(output[p.field]).slice(0, Array.from(p.value).length).join(''), 'Case-sensitive prefix',
  output[p.field] === '' ? missing(output, p.field) : spanEvidence(output, p.field, 0, Math.min(Array.from(output[p.field]).length, Array.from(p.value).length))));
