import { z } from 'zod';
import { matchEvidence } from '../evidence.ts';
import { guardedRegex } from './regex-guard.ts';
import { defineCheck, missing, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ pattern: z.string(), flags: z.string().default('u'), field: TextFieldSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  const match = guardedRegex(p.pattern, p.flags, output[p.field]).exec(output[p.field]);
  return result(output, p.field, match !== null, p.pattern, match?.[0] ?? null, 'Guarded regex match',
    match ? matchEvidence(output, p.field, match.index, match[0]) : missing(output, p.field));
});
