import { z } from 'zod';

export const JsonValueSchema: z.ZodType<import('../canonical.ts').JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValueSchema), z.record(JsonValueSchema)]),
);
export const ToolCallSchema = z.object({ name: z.string().min(1), args: JsonValueSchema }).strict();
export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  reasoning_tokens: z.number().int().nonnegative().optional(),
}).strict();
/** Canonical provider reasons plus recognised one-turn OpenAI-compatible spellings. */
export const KNOWN_STOP_REASONS = ['end_turn', 'max_tokens', 'tool_use', 'refusal', 'stop_sequence', 'stop', 'length', 'tool_calls', 'content_filter'] as const;
export const OutputSchema = z.object({
  text: z.string(),
  thinking: z.string(),
  tool_calls: z.array(ToolCallSchema),
  tool_calls_original: z.array(ToolCallSchema),
  stop_reason: z.enum(KNOWN_STOP_REASONS).nullable(),
  usage: UsageSchema.nullable(),
  latency_ms: z.number().finite().nonnegative().nullable(),
}).strict();
export type NormalisedOutput = z.infer<typeof OutputSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export const RecordingLineSchema = z.object({
  task_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  sample: z.number().int().min(1).max(5),
  raw: JsonValueSchema.optional(),
  output: OutputSchema.nullable(),
  error: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.output === null) !== (value.error !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one of output or recorded error is required' });
  }
});
export type RecordingLine = z.infer<typeof RecordingLineSchema>;
