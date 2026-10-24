import { z } from 'zod';
import { compileJsonSchema, defineCheck, JsonSchemaParam, result, TextFieldSchema } from './shared.ts';
export const paramsSchema = z.object({ schema: JsonSchemaParam, field: TextFieldSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => {
  const validate = compileJsonSchema(p.schema);
  let value: unknown;
  try { value = JSON.parse(output[p.field]); }
  catch { return result(output, p.field, false, p.schema, 'invalid JSON', 'Output is not JSON'); }
  return result(output, p.field, validate(value), p.schema, value, 'Local JSON Schema validation (Ajv)');
});
