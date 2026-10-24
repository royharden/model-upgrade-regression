import { z } from 'zod';
import { defineCheck, missing, namedToolEvidence, result } from './shared.ts';
export const paramsSchema = z.object({ name: z.string().min(1), min: z.number().int().positive().default(1) }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  const matches = output.tool_calls.map((call, index) => ({ call, index })).filter(({ call }) => call.name === p.name);
  return result(output, 'tool_calls', matches.length >= p.min, { name: p.name, min: p.min }, matches.length,
    'Named tool presence with multiplicity', matches[0] ? namedToolEvidence(output, 'tool_calls', matches[0].index) : missing(output, 'tool_calls'));
});
