import { z } from 'zod';
import { defineCheck, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ field: TextFieldSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  try { JSON.parse(output[p.field]); return result(output, p.field, true, 'valid JSON', 'valid JSON', 'Whole field parses as JSON'); }
  catch { return result(output, p.field, false, 'valid JSON', 'invalid JSON', 'Whole field does not parse as JSON'); }
});
