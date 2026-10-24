import { z } from 'zod';
import { BoundSchema, defineCheck, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ min: BoundSchema.int(), max: BoundSchema.int(), field: TextFieldSchema }).strict()
  .refine((p) => p.min <= p.max, 'min must not exceed max');
export default defineCheck(paramsSchema, (output, p) => {
  const count = output[p.field].split('\n').filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/u.test(line)).length;
  return result(output, p.field, count >= p.min && count <= p.max, { min: p.min, max: p.max }, count,
    'Bullet lines: hyphen, asterisk, bullet glyph, or numbered marker');
});
