import { z } from 'zod';
import { canonical } from '../canonical.ts';
import { JsonValueSchema } from '../schema/output.ts';
import { compileJsonSchema, defineCheck, JsonSchemaParam, missing, namedToolEvidence, result } from './shared.ts';
export const paramsSchema = z.object({ name: z.string().min(1), expected: JsonValueSchema.optional(), schema: JsonSchemaParam.optional() }).strict()
  .refine((p) => (p.expected !== undefined) !== (p.schema !== undefined), 'Specify exactly one of expected or schema');
export default defineCheck(paramsSchema, (output, p) => {
  const validate = p.schema === undefined ? (args: unknown) => canonical(args) === canonical(p.expected) : compileJsonSchema(p.schema);
  const matches = output.tool_calls.map((call, index) => ({ call, index })).filter(({ call }) => call.name === p.name);
  const offender = matches.find(({ call }) => !validate(call.args));
  const evidenceCall = offender ?? matches[0];
  return result(output, 'tool_calls', matches.length > 0 && !offender, p.schema ?? p.expected, matches.map(({ call }) => call.args),
    `All ${matches.length} calls of ${p.name} must match (missing tool fails)`, evidenceCall
      ? namedToolEvidence(output, 'tool_calls', evidenceCall.index) : missing(output, 'tool_calls'));
});
