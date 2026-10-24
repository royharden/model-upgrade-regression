import Ajv from 'ajv';
import { z } from 'zod';
import { canonical } from '../canonical.ts';
import { anchorEvidence, fieldView, matchEvidence, spanEvidence, type CheckResult, type Evidence, type EvidenceField } from '../evidence.ts';
import { JsonValueSchema, type NormalisedOutput } from '../schema/output.ts';

export const TextFieldSchema = z.enum(['text', 'thinking']).default('text');
export const BoundSchema = z.number().finite().nonnegative();
export const JsonSchemaParam = z.union([z.boolean(), z.record(JsonValueSchema)]).superRefine((schema, ctx) => {
  try { assertLocalRefs(schema); }
  catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Unsupported schema' }); }
});
export interface CheckPrices {
  currency: 'USD'; input_per_mtok: number; output_per_mtok: number;
  reasoning_per_mtok?: number;
  /** If omitted, reasoning tokens are already included in reported output tokens. */
  reasoning_in_output_tokens?: boolean;
  verified_date: string | null; synthetic: boolean;
}
export interface CheckContext { check_prices?: CheckPrices | null }
export interface CheckDefinition {
  params: z.ZodTypeAny;
  evaluate: (output: NormalisedOutput, params: unknown, context: CheckContext) => CheckResult;
}
export function defineCheck<S extends z.ZodTypeAny>(params: S,
  evaluate: (output: NormalisedOutput, params: z.output<S>, context: CheckContext) => CheckResult,
): CheckDefinition {
  return { params, evaluate: (output, value, context) => evaluate(output, params.parse(value), context) };
}
export function result(output: NormalisedOutput, field: EvidenceField, pass: boolean, expected: unknown,
  observed: unknown, detail: string, evidence?: Evidence,
): CheckResult {
  return { status: pass ? 'pass' : 'fail', expected, observed, detail, evidence: evidence ?? spanEvidence(output, field) };
}
export function errorResult(output: NormalisedOutput, field: EvidenceField, detail: string, expected: unknown = null): CheckResult {
  return { status: 'error', expected, observed: null, detail, evidence: anchorEvidence(output, field) };
}
export function missing(output: NormalisedOutput, field: EvidenceField): Evidence {
  return anchorEvidence(output, field, Array.from(fieldView(output, field)).length);
}
export function namedToolEvidence(output: NormalisedOutput, field: 'tool_calls' | 'tool_calls_original', index: number): Evidence {
  const view = fieldView(output, field);
  const target = canonical(output[field][index]);
  // Canonical arrays indent each object's lines by two more spaces.
  const nested = target.split('\n').map((line, lineIndex) => lineIndex === 0 ? line : `  ${line}`).join('\n');
  let start = 0;
  for (let i = 0; i <= index; i++) {
    const current = canonical(output[field][i]).split('\n').map((line, lineIndex) => lineIndex === 0 ? line : `  ${line}`).join('\n');
    const found = view.indexOf(current, start);
    if (i === index && found >= 0) return matchEvidence(output, field, found, nested);
    start = found + current.length;
  }
  return spanEvidence(output, field);
}
export function assertLocalRefs(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertLocalRefs); return; }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === '$ref' || key === '$dynamicRef' || key === '$recursiveRef') &&
      (typeof child !== 'string' || !child.startsWith('#'))) throw new Error('Remote schema references are forbidden');
    if (key === '$async' && child === true) throw new Error('Async schemas are forbidden');
    assertLocalRefs(child);
  }
}
export function compileJsonSchema(schema: unknown): (data: unknown) => boolean {
  assertLocalRefs(schema);
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: true, ownProperties: true });
  const validate = ajv.compile(schema as object | boolean);
  return (data) => validate(data) === true;
}
