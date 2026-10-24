import { describe, expect, it } from 'vitest';
import oldJsonl from '../../../fixtures/recordings/old.jsonl?raw';
import newJsonl from '../../../fixtures/recordings/new.jsonl?raw';
import { demoSuite, runDemo } from '../../../src/lib/demo.ts';
import { parseRecordings, assertCompleteRecordings } from '../../../src/lib/recordings.ts';
import { MemoryStore } from '../../../src/lib/store/memory.ts';
import { normalise } from '../../../src/core/regressdiff/normalise.ts';
import { CHECK_TYPES } from '../../../src/core/regressdiff/checks/index.ts';
import { PolicySchema } from '../../../src/core/regressdiff/schema/policy.ts';
import policyJson from '../../../fixtures/policy.json';

describe('independently authored offline corpus', () => {
  it('has 40 tasks with prescribed categories, semantic facts, and every deterministic check type', () => {
    expect(demoSuite.tasks).toHaveLength(40);
    const categoryCounts = Object.fromEntries(['format', 'constraint', 'tool_call', 'refusal', 'length', 'semantic'].map((category) => [category, demoSuite.tasks.filter((task) => task.category === category).length]));
    expect(categoryCounts).toEqual({ format: 8, constraint: 8, tool_call: 8, refusal: 6, length: 4, semantic: 6 });
    expect(new Set(demoSuite.tasks.flatMap((task) => task.checks.map((check) => check.type)))).toEqual(new Set(CHECK_TYPES));
    expect(demoSuite.tasks.filter((task) => task.category === 'semantic').every((task) => task.required_facts?.length)).toBe(true);
    expect(demoSuite.tasks.filter((task) => task.category === 'refusal' && (task.checks[0].params as { expected: string }).expected === 'answered')).toHaveLength(4);
    expect(PolicySchema.safeParse(policyJson).success).toBe(true);
  });
  it('contains five normalised samples per task/side and exactly one isolated old error', () => {
    const old = parseRecordings(oldJsonl), next = parseRecordings(newJsonl);
    expect(old).toHaveLength(200); expect(next).toHaveLength(200);
    expect(() => assertCompleteRecordings(demoSuite, old)).not.toThrow();
    expect(() => assertCompleteRecordings(demoSuite, next)).not.toThrow();
    expect(old.filter((line) => line.error)).toMatchObject([{ task_id: 'con.error', sample: 2, error: 'synthetic_recorded_provider_error' }]);
    expect(next.filter((line) => line.error)).toHaveLength(0);
    expect(demoSuite.tasks.find((task) => task.id === 'con.error')?.checks).toHaveLength(1);
    for (const line of [...old, ...next]) if (line.output) {
      const task = demoSuite.tasks.find((task) => task.id === line.task_id)!;
      expect(normalise(line.output, task)).toEqual(line.output);
    }
    expect(new Set(old.flatMap((line) => line.output?.latency_ms ?? [])).size).toBeGreaterThan(3);
  });
  it('preserves benign differences in raw/source traces while the stored answer is normalised', () => {
    const old = parseRecordings(oldJsonl), next = parseRecordings(newJsonl);
    const pick = (lines: typeof old, id: string) => lines.find((line) => line.task_id === id && line.sample === 1)!;
    expect(pick(old, 'fmt.json-order').raw).not.toEqual(pick(next, 'fmt.json-order').raw);
    expect(pick(old, 'fmt.json-order').output?.text).toBe(pick(next, 'fmt.json-order').output?.text);
    expect(pick(next, 'fmt.trailing').raw).toMatchObject({ text: 'Ready\n' });
    expect(pick(next, 'fmt.trailing').output?.text).toBe('Ready');
    expect(pick(old, 'tool.independent').output?.tool_calls).toEqual(pick(next, 'tool.independent').output?.tool_calls);
    expect(pick(old, 'tool.independent').output?.tool_calls_original).not.toEqual(pick(next, 'tool.independent').output?.tool_calls_original);
  });
});
describe('demo trace: fixture -> replay -> stored samples -> cells', () => {
  for (const k of [3, 5] as const) it(`contains the named journey verdicts at k=${k}`, async () => {
    const store = new MemoryStore(), seen: number[] = [];
    const { run, comparison } = await runDemo(demoSuite, { k, old_model: 'mock:old', new_model: 'mock:new' }, store, ({ completed }) => seen.push(completed));
    const verdict = (id: string) => comparison.cells.find((cell) => cell.task_id === id)?.verdict;
    expect(verdict('tool.forbidden')).toBe('REGRESSED');
    expect(verdict('tool.args')).toBe('REGRESSED');
    expect(verdict('con.thinking')).toBe('REGRESSED');
    expect(verdict('fmt.prefix')).toBe('REGRESSED');
    expect(verdict('len.noise')).toBe('WITHIN_NOISE');
    expect(verdict('con.preexisting')).toBe('PRE_EXISTING');
    expect(verdict('fmt.exact-improved')).toBe('IMPROVED');
    expect(verdict('con.error')).toBe('COULD_NOT_JUDGE');
    expect(comparison.cells.filter((cell) => cell.verdict === 'COULD_NOT_JUDGE')).toHaveLength(1);
    for (const id of ['fmt.json-order', 'fmt.bullets', 'fmt.trailing', 'tool.independent']) {
      expect(verdict(id)).toBe('UNCHANGED');
      expect(comparison.findings.some((finding) => finding.task_id === id)).toBe(false);
    }
    expect(comparison.findings[0].check_type).toBe('tool_forbidden');
    expect(seen).toHaveLength(40 * 2 * k + 1);
    expect(seen[0]).toBe(0); expect(seen.at(-1)).toBe(40 * 2 * k);
    expect(store.listSamples(run.id)).toHaveLength(40 * 2 * k);
    expect(comparison.manifest.old_model.check_prices?.synthetic).toBe(true);
    expect(comparison.cells.find((cell) => cell.task_id === 'con.cost')?.verdict).toBe('REGRESSED');
  });
});
