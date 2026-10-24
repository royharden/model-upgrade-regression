import { z } from 'zod';
import { matchEvidence } from '../evidence.ts';
import { defineCheck, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ words: z.array(z.string().min(1)).min(1), case_sensitive: z.boolean().default(false), field: TextFieldSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  // Literal substring matching, including multiword phrases. Escape rather than execute configured words.
  const pattern = p.words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = new RegExp(pattern, p.case_sensitive ? 'u' : 'iu').exec(output[p.field]);
  return result(output, p.field, !match, p.words, match?.[0] ?? null, 'No banned literal substrings',
    match ? matchEvidence(output, p.field, match.index, match[0]) : undefined);
});
