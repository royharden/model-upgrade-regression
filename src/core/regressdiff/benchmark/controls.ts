import type { NormalisedOutput } from '../schema/output.ts';
import type { Task } from '../schema/suite.ts';
import { cloneJson } from './injectors.ts';
import type { ControlKind } from './types.ts';

export function canControl(kind: ControlKind, task: Task, output: NormalisedOutput): boolean {
  switch (kind) {
    case 'trailing_newline': return true;
    case 'json_key_reorder':
      try { const value: unknown = JSON.parse(output.text); return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 1; }
      catch { return false; }
    case 'independent_tool_reorder': return task.independent_tool_calls && output.tool_calls_original.length >= 2 && !task.checks.some((check) => check.type === 'tool_order');
    case 'bullet_glyph_change': return /^\s*[-*•]\s+/mu.test(output.text) && task.checks.every((check) => check.type === 'bullet_count');
    case 'fact_paraphrase': return task.id === 'sem.paraphrase' && task.checks.every((check) => check.type === 'length');
    case 'latency_jitter_under_cap': return output.latency_ms !== null && task.checks.some((check) => check.type === 'latency_budget');
    case 'already_failing_old': return task.id === 'con.preexisting' || task.id === 'tool.preexisting';
  }
}
/** Raw output is intentional here: normalisation tolerance is part of what the benchmark measures. */
export function benignControl(kind: ControlKind, task: Task, source: NormalisedOutput, nonce = 0): NormalisedOutput {
  if (!canControl(kind, task, source)) throw new Error(`Unsupported control ${kind} task ${task.id}`);
  const next = cloneJson(source);
  switch (kind) {
    case 'trailing_newline': next.text += '\n'.repeat(1 + nonce % 3); break;
    case 'json_key_reorder': {
      const value = JSON.parse(next.text) as Record<string, unknown>;
      next.text = JSON.stringify(Object.fromEntries(Object.keys(value).sort().reverse().map((key) => [key, value[key]])), null, 2);
      break;
    }
    case 'independent_tool_reorder':
      next.tool_calls_original.reverse();
      next.tool_calls = cloneJson(next.tool_calls_original);
      break;
    case 'bullet_glyph_change': next.text = next.text.replace(/^(\s*)[-*•](\s+)/gmu, `$1${nonce % 2 ? '*' : '•'}$2`); break;
    case 'fact_paraphrase': next.text = nonce % 2 ? 'Mercury remains the closest planet to the Sun.' : 'The planet closest to the Sun is Mercury.'; break;
    case 'latency_jitter_under_cap': {
      const limits = task.checks.filter((check) => check.type === 'latency_budget').map((check) => Number((check.params as { max_ms: number }).max_ms));
      next.latency_ms = Math.min(...limits) * (0.2 + nonce % 60 / 100);
      break;
    }
    case 'already_failing_old': break; // Identical pre-existing failure is a deliberate model-matrix trap.
  }
  return next;
}
