import { z } from 'zod';
import { defineCheck, namedToolEvidence, result } from './shared.ts';
export const paramsSchema = z.object({ name: z.string().min(1) }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  const matches = output.tool_calls.map((call, index) => ({ call, index })).filter(({ call }) => call.name === p.name);
  return result(output, 'tool_calls', matches.length === 0, { name: p.name, count: 0 }, matches.length,
    'Forbidden tool absence with multiplicity', matches[0] ? namedToolEvidence(output, 'tool_calls', matches[0].index) : undefined);
});
