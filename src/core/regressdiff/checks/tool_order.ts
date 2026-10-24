import { z } from 'zod';
import { defineCheck, missing, namedToolEvidence, result } from './shared.ts';
export const paramsSchema = z.object({ names: z.array(z.string().min(1)).min(1) }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  let next = 0;
  let lastMatch = -1;
  output.tool_calls_original.forEach((call, index) => { if (next < p.names.length && call.name === p.names[next]) { next++; lastMatch = index; } });
  return result(output, 'tool_calls_original', next === p.names.length, p.names, output.tool_calls_original.map((call) => call.name),
    `Required subsequence; matched ${next}/${p.names.length}`,
    next === p.names.length ? namedToolEvidence(output, 'tool_calls_original', lastMatch) : missing(output, 'tool_calls_original'));
});
