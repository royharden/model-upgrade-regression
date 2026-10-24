import { z } from 'zod';
import { canonical, utf8Bytes } from '../canonical.ts';
import { checks, CHECK_TYPES, type CheckConfig, type CheckType } from '../checks/index.ts';
import { regexWarning } from '../checks/regex-guard.ts';
import { compileJsonSchema, JsonSchemaParam } from '../checks/shared.ts';

export const IdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
export const CategorySchema = z.enum(['format', 'constraint', 'tool_call', 'refusal', 'length', 'semantic']);
export const CheckSchema = z.object({ id: IdSchema, type: z.enum(CHECK_TYPES as [CheckType, ...CheckType[]]), params: z.unknown() }).strict()
  .superRefine((check, ctx) => {
    const parsed = checks[check.type].params.safeParse(check.params);
    if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ['params', ...issue.path] });
  }).transform((check): CheckConfig => ({ ...check, params: checks[check.type].params.parse(check.params) }));
export const MessageSchema = z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }).strict();
export const ToolSchema = z.object({ name: z.string().min(1), description: z.string(), input_schema: JsonSchemaParam }).strict();
const TaskObject = z.object({
  id: IdSchema, category: CategorySchema, messages: z.array(MessageSchema).min(1), tools: z.array(ToolSchema),
  checks: z.array(CheckSchema).min(1), independent_tool_calls: z.boolean(), required_facts: z.array(z.string().min(1)).optional(),
}).strict();
export const TaskSchema = TaskObject.superRefine((task, ctx) => {
  if (new Set(task.checks.map((check) => check.id)).size !== task.checks.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checks'], message: 'Duplicate check ids within task' });
  }
  if (utf8Bytes(canonical(task)) > 8192) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Canonical task exceeds 8192 UTF-8 bytes' });
});
export const SuiteSchema = z.object({ id: IdSchema, name: z.string().min(1), tasks: z.array(TaskSchema).min(1).max(100) }).strict()
  .superRefine((suite, ctx) => {
    if (new Set(suite.tasks.map((task) => task.id)).size !== suite.tasks.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tasks'], message: 'Duplicate task ids' });
    }
  });
export type Suite = z.infer<typeof SuiteSchema>;
export type Task = z.infer<typeof TaskSchema>;
export interface SuiteWarning { task_id: string; check_id: string; message: string }
/** Warnings identify runtime-abstaining configurations without pretending they passed. */
export function suiteWarnings(suite: Suite): SuiteWarning[] {
  const warnings: SuiteWarning[] = [];
  for (const task of suite.tasks) for (const check of task.checks) {
    const params = check.params as Record<string, unknown>;
    let message: string | null = null;
    if (check.type === 'regex') message = regexWarning(String(params.pattern), String(params.flags ?? 'u'));
    if (check.type === 'json_schema' || (check.type === 'tool_args' && params.schema !== undefined)) {
      try { compileJsonSchema(params.schema); } catch (error) { message = error instanceof Error ? error.message : 'Invalid JSON Schema'; }
    }
    if (message) warnings.push({ task_id: task.id, check_id: check.id, message });
  }
  return warnings;
}
