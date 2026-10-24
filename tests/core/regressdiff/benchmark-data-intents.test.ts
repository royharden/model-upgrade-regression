import { describe, expect, it } from 'vitest';
import suiteJson from '../../../fixtures/suite.demo.json';
import oldJsonl from '../../../fixtures/recordings/old.jsonl?raw';
import { parseRecordings } from '../../../src/lib/recordings.ts';
import { runCheck } from '../../../src/core/regressdiff/checks/index.ts';
import { SuiteSchema } from '../../../src/core/regressdiff/schema/suite.ts';
import { buildBenchmark, BENCHMARK_CHECK_CONTEXT } from '../../../src/core/regressdiff/benchmark/manifest.ts';
import { recountOutputTokens, inject } from '../../../src/core/regressdiff/benchmark/injectors.ts';
import { normalise } from '../../../src/core/regressdiff/normalise.ts';

const suite = SuiteSchema.parse(suiteJson), old = parseRecordings(oldJsonl);
const { variants } = buildBenchmark(suite, old);
describe('benchmark injectors target an existing declared check', () => {
  it('passes every labelled old target and fails its planted new target in all five samples', () => {
    for (const item of variants.filter((row) => row.kind === 'planted' && row.expected_check_id !== null)) {
      const check = item.suite.tasks[0].checks.find((entry) => entry.id === item.expected_check_id)!;
      expect(check.type).toBe(item.expected_check_type);
      for (let sample = 0; sample < 5; sample++) {
        expect(runCheck(check, item.old[sample].output!, BENCHMARK_CHECK_CONTEXT).status, item.id).toBe('pass');
        expect(runCheck(check, item.new[sample].output!, BENCHMARK_CHECK_CONTEXT).status, item.id).toBe('fail');
      }
    }
  });
  it('names undeclared lost-fact misses without adding checks to make them detectable', () => {
    const missed = variants.filter((row) => row.kind === 'planted' && row.expected_check_id === null);
    expect(missed.length).toBeGreaterThan(0);
    for (const item of missed) {
      expect(item.class_name).toBe('lost_fact');
      expect(item.expected_check_type).toBeNull();
      expect(item.expected_miss_reason).toMatch(/no declared deterministic fact check/u);
      expect(item.suite.tasks[0].checks).toEqual(suite.tasks.find((task) => task.id === item.task_id)!.checks);
      const facts = item.suite.tasks[0].required_facts!;
      for (const row of item.new) for (const fact of facts) expect(row.output!.text.toLowerCase()).not.toContain(fact.toLowerCase());
    }
  });
  it('does not accidentally restore a numeric required fact through a seed nonce', () => {
    const task = suite.tasks.find((entry) => entry.id === 'sem.number')!;
    const source = old.find((row) => row.task_id === task.id && row.sample === 1)!.output!;
    const planted = inject('lost_fact', task, source, 12);
    expect(planted.text).not.toContain('12');
    expect(runCheck(task.checks[0], planted, BENCHMARK_CHECK_CONTEXT).status).toBe('fail');
  });
  it('feeds the actual text-token-recount cost injector into cost_budget (deferred M1/M4 integration contract)', () => {
    const task = suite.tasks.find((entry) => entry.id === 'con.cost')!, check = task.checks[0];
    const source = old.find((row) => row.task_id === task.id && row.sample === 1)!.output!;
    const planted = inject('token_recount_cost_jump', task, source, 7);
    expect(planted.usage?.input_tokens).toBe(source.usage?.input_tokens);
    expect(planted.usage?.output_tokens).toBe(recountOutputTokens(planted.text));
    expect(planted.usage!.output_tokens).toBeGreaterThan(source.usage!.output_tokens);
    expect(runCheck(check, source, BENCHMARK_CHECK_CONTEXT).status).toBe('pass');
    expect(runCheck(check, normalise(planted, task), BENCHMARK_CHECK_CONTEXT)).toMatchObject({ status: 'fail', evidence: { field: 'usage' } });
    expect(recountOutputTokens('one two, three!')).toBe(5);
  });
  it('reverses injectors on reserved improvement tasks, separate from planted task identities', () => {
    const plants = new Set(variants.filter((row) => row.kind === 'planted').map((row) => row.task_id));
    for (const item of variants.filter((row) => row.kind === 'improvement')) {
      expect(plants.has(item.task_id)).toBe(false);
      const check = item.suite.tasks[0].checks.find((entry) => entry.id === item.expected_check_id)!;
      expect(check).toBeDefined();
      for (let sample = 0; sample < 5; sample++) {
        expect(runCheck(check, item.old[sample].output!, BENCHMARK_CHECK_CONTEXT).status).toBe('fail');
        expect(runCheck(check, item.new[sample].output!, BENCHMARK_CHECK_CONTEXT).status).toBe('pass');
      }
    }
  });
});
describe('benign-control intent and raw ablation views', () => {
  it('preserves each declared check status and never introduces an error in a control', () => {
    for (const item of variants.filter((row) => row.kind === 'control')) for (let sample = 0; sample < 5; sample++) {
      for (const check of item.suite.tasks[0].checks) {
        const before = runCheck(check, item.old[sample].output!, BENCHMARK_CHECK_CONTEXT);
        const after = runCheck(check, item.new[sample].output!, BENCHMARK_CHECK_CONTEXT);
        expect(after.status, `${item.id}/${sample + 1}`).toBe(before.status);
        expect(after.status).not.toBe('error');
      }
    }
  });
  it('retains the exact benign mutations for ablation and a pre-existing-failure trap', () => {
    const pick = (name: string) => variants.find((row) => row.kind === 'control' && row.class_name === name)!;
    const newline = pick('trailing_newline');
    expect(newline.raw_new[0].output!.text).toMatch(/\n$/u);
    expect(newline.new[0].output!.text).toBe(newline.old[0].output!.text);
    const json = pick('json_key_reorder');
    expect(json.raw_new[0].output!.text).not.toBe(json.raw_old[0].output!.text);
    expect(json.new[0].output!.text).toBe(json.old[0].output!.text);
    const tools = pick('independent_tool_reorder');
    expect(tools.new[0].output!.tool_calls).toEqual(tools.old[0].output!.tool_calls);
    expect(tools.raw_new[0].output!.tool_calls_original).not.toEqual(tools.raw_old[0].output!.tool_calls_original);
    const bullets = pick('bullet_glyph_change');
    expect(bullets.new[0].output!.text).not.toBe(bullets.old[0].output!.text);
    const existing = pick('already_failing_old'), check = existing.suite.tasks[0].checks[0];
    expect(runCheck(check, existing.old[0].output!, BENCHMARK_CHECK_CONTEXT).status).toBe('fail');
    expect(existing.new).toEqual(existing.old);
  });
});
