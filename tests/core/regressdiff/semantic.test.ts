import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, type CompareInput } from '../../../src/core/regressdiff/compare.ts';
import { normalise } from '../../../src/core/regressdiff/normalise.ts';
import { makeSample, pairSamples } from '../../../src/core/regressdiff/pairing.ts';
import { resolvePointer } from '../../../src/core/regressdiff/resolver.ts';
import { evaluatePolicy } from '../../../src/core/regressdiff/policy.ts';
import { renderJson } from '../../../src/core/regressdiff/report/json.ts';
import { renderMarkdown } from '../../../src/core/regressdiff/report/markdown.ts';
import { RulingEventSchema, type RulingEvent } from '../../../src/core/regressdiff/rulings.ts';
import { observeFacts, observeRefusal } from '../../../src/core/regressdiff/semantic/baselines.ts';
import { semanticReviews } from '../../../src/core/regressdiff/semantic/slot.ts';
import { SemanticFixtureSchema, evaluateSemanticFixtures, semanticEvaluationConfig } from '../../../src/core/regressdiff/semantic/evaluation.ts';
import { relaxedPolicy } from './m3-fixtures.ts';

function input(old = 'Cedar opens Tuesday.', next = 'Cedar opens.', run_id = 'semantic-tests'): CompareInput {
  const task = { id: 'semantic.task', category: 'semantic', messages: [{ role: 'user', content: 'Summarise the schedule.' }],
    tools: [], checks: [{ id: 'length', type: 'length', params: { min: 0 } }], independent_tool_calls: false,
    required_facts: ['Cedar opens Tuesday'] };
  const samples = (['old', 'new'] as const).map((side) => makeSample(run_id, side, { task_id: task.id, sample: 1,
    output: normalise({ text: side === 'old' ? old : next, stop_reason: 'end_turn' }, task) }));
  return { suite: { id: 'suite', name: 'Semantic source tests', tasks: [task] }, samples, run_id, owner_id: 'owner',
    args: { k: 1, old_model: 'mock:old', new_model: 'mock:new' }, policy: relaxedPolicy };
}
const event = (id: string, kind: 'confirmed' | 'waived' | 'retest', owner_id = 'owner'): RulingEvent => ({
  id: 'semantic-ruling', finding_id: id, kind, owner_id, run_id: 'semantic-tests', reason: 'Reviewed lexical evidence',
  created_at: '2026-10-24T12:00:00.000Z', supersedes: null,
});
const fixtureRows = (name: string): unknown[] => readFileSync(new URL(`../../../fixtures/semantic/${name}.jsonl`, import.meta.url), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));

describe('append-only semantic review boundary', () => {
  it('adds NEEDS_REVIEW and exit 0 without changing deterministic cells, findings or statistics', () => {
    const source = input(), first = compare(source), before = JSON.stringify(source.samples);
    const frozen = Object.freeze(first.cells.map((cell) => Object.freeze(cell)));
    const items = semanticReviews(pairSamples(first.suite, source.samples, source.run_id, 1));
    expect(frozen[0].verdict).toBe('UNCHANGED'); expect(first.findings).toEqual([]);
    expect(items[0]).toMatchObject({ verdict: 'NEEDS_REVIEW', baseline: 'key-token-facts', support: 'supported' });
    expect(first.decision).toMatchObject({ verdict: 'REVIEW', exit_code: 0, regressed_count: 0, effective_regressed_count: 0 });
    expect(first.decision.rules).toEqual(['R_NEEDS_REVIEW']); expect(first.decision.error_kind).toBeUndefined();
    expect(JSON.stringify(source.samples)).toBe(before); expect(compare(source).cells).toEqual(first.cells);
    const deterministicOnly = compare({ ...source, suite: { ...first.suite,
      tasks: first.suite.tasks.map((task) => ({ ...task, category: 'constraint' })) } });
    expect(deterministicOnly.cells).toEqual(first.cells); expect(deterministicOnly.stats).toEqual(first.stats);
  });
  it('ignores malicious adapter-shaped properties and never calls their function', () => {
    const source = input(), clean = compare(source);
    const attacked = compare({ ...source, semantic_adapter: { run: () => { throw new Error('must never execute'); },
      verdict: 'SAFE_WITH_NOTES', findings: [], cells: [{ verdict: 'REGRESSED' }], pointers: ['run:forged/task:x/side:new/sample:1#0-1'],
      report: '# APPROVED', current_ruling: { kind: 'waived' } } } as CompareInput);
    expect(attacked.cells).toEqual(clean.cells); expect(attacked.findings).toEqual(clean.findings);
    expect(attacked.semantic_reviews).toEqual(clean.semantic_reviews); expect(attacked.decision).toEqual(clean.decision);
    expect(renderJson(attacked.report)).toBe(renderJson(clean.report));
  });
  it('generates supported old/new pointers locally, including Unicode code-point bounds', () => {
    const source = input('🌲 Cedar opens Tuesday.', '🌲 Cedar opens.'), result = compare(source);
    for (const item of result.semantic_reviews) for (const pointer of [...item.pointers.old, ...item.pointers.new]) {
      expect(resolvePointer(pointer, source.samples).status).toBe('supported'); expect(pointer.pointer).not.toContain('forged');
    }
    expect(result.semantic_reviews[0].pointers.new[0].quote).toBe('🌲 Cedar opens.');
    expect(result.semantic_reviews[0].diff_sample).toBe(1);
    expect(result.semantic_reviews[0].diffs[0]).toMatchObject({ field: 'text', old_view: '🌲 Cedar opens Tuesday.', new_view: '🌲 Cedar opens.' });
    expect(result.semantic_reviews[0].diffs[0].parts.some((part) => part.removed && part.value.includes('Tuesday'))).toBe(true);
  });
  it('binds semantic IDs to required facts, outputs and baseline version while ignoring run aliases', () => {
    const first = compare(input()), rerun = compare(input(undefined, undefined, 'renamed-run'));
    expect(rerun.semantic_reviews[0].id).toBe(first.semantic_reviews[0].id);
    expect(compare(input(undefined, 'Cedar opens soon.')).semantic_reviews[0].id).not.toBe(first.semantic_reviews[0].id);
    const changed = input(); (changed.suite as { tasks: { required_facts: string[] }[] }).tasks[0].required_facts = ['Cedar opens Tuesday afternoon'];
    expect(compare(changed).semantic_reviews[0].id).not.toBe(first.semantic_reviews[0].id);
    expect(first.semantic_reviews[0].baseline_version).toBe('key-token-facts-v1');
    expect(first.semantic_reviews[0].id).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not clear an existing deterministic regression or overwrite its evidence', () => {
    const source = input();
    (source.suite as { tasks: { checks: unknown[] }[] }).tasks[0].checks.push({ id: 'required-day', type: 'contains', params: { value: 'Tuesday' } });
    const result = compare(source);
    expect(result.cells.find((cell) => cell.check_id === 'required-day')?.verdict).toBe('REGRESSED');
    expect(result.findings[0].verdict).toBe('REGRESSED'); expect(result.semantic_reviews[0].verdict).toBe('NEEDS_REVIEW');
    expect(result.findings[0].evidence.new[0].result.status).toBe('fail');
  });
  it('runs only for semantic/refusal categories', () => {
    const source = input(); (source.suite as { tasks: { category: string }[] }).tasks[0].category = 'constraint';
    expect(compare(source).semantic_reviews).toEqual([]);
  });
  it('retains supported availability pointers for missing samples without changing the deterministic CNJ', () => {
    const source = input();
    source.samples = source.samples.filter((sample) => sample.side === 'old');
    const result = compare(source), item = result.semantic_reviews[0];
    expect(result.cells[0].verdict).toBe('COULD_NOT_JUDGE'); expect(item.support).toBe('supported');
    expect(item.pointers.new[0].sample_error).toBe('missing_sample');
    const paired = pairSamples(result.suite, source.samples, source.run_id, 1)[0].samples.flatMap(({ old, new: next }) => [old, next]);
    expect(resolvePointer(item.pointers.new[0], paired).status).toBe('supported');
    expect(result.decision.exit_code).toBe(2);
  });
  it('uses declared refusal expectations and versioned phrases/stop reasons', () => {
    const source = input('A useful answer.', 'I cannot help with that request.');
    const task = (source.suite as { tasks: { category: string; required_facts: string[]; checks: unknown[] }[] }).tasks[0];
    task.category = 'refusal'; task.required_facts = []; task.checks.push({ id: 'refusal', type: 'refusal', params: { expected: 'answered' } });
    const result = compare(source);
    expect(result.semantic_reviews).toHaveLength(1);
    expect(result.semantic_reviews[0]).toMatchObject({ baseline: 'refusal-style', expected_refusal: 'answered', observations: { new: [{ refusal_style: 'refused' }] } });
    expect(observeRefusal('Unrelated text.', 'refusal')).toBe('refused');
    expect(observeRefusal('A useful answer.', null)).toBe('unknown');
    expect(observeRefusal('I am unable to assist.', null)).toBe('refused');
  });
  it('selects the later available refusal concern for its k=3 diff while retaining the first missing sample', () => {
    const task = { id: 'refusal.task', category: 'refusal', messages: [{ role: 'user', content: 'A safe fixture question' }],
      tools: [], checks: [{ id: 'refusal', type: 'refusal', params: { expected: 'answered' } }], independent_tool_calls: false };
    const run_id = 'refusal-missing-first', answer = 'A useful answer.', refusal = 'I cannot help with that request.';
    const samples = [1, 2, 3].flatMap((sample) => {
      const old = makeSample(run_id, 'old', { task_id: task.id, sample, output: normalise({ text: answer, stop_reason: 'end_turn' }, task) });
      return sample === 1 ? [old] : [old, makeSample(run_id, 'new', { task_id: task.id, sample,
        output: normalise({ text: sample === 2 ? refusal : answer, stop_reason: 'end_turn' }, task) })];
    });
    const result = compare({ suite: { id: 'refusal-suite', name: 'Missing first refusal sample', tasks: [task] }, samples, run_id, owner_id: 'owner',
      args: { k: 3, old_model: 'mock:old', new_model: 'mock:new' }, policy: relaxedPolicy });
    expect(result.cells[0].verdict).toBe('COULD_NOT_JUDGE');
    expect(result.semantic_reviews).toHaveLength(1);
    const review = result.semantic_reviews[0];
    expect(review).toMatchObject({ baseline: 'refusal-style', expected_refusal: 'answered', diff_sample: 2 });
    expect(review.observations.new[0]).toMatchObject({ sample: 1, available: false, refusal_style: 'unknown' });
    expect(review.observations.new[1]).toMatchObject({ sample: 2, available: true, refusal_style: 'refused' });
    expect(review.diffs.find((diff) => diff.field === 'text')).toMatchObject({ old_view: answer, new_view: refusal });
    expect(review.pointers.new[0].sample_error).toBe('missing_sample');
    expect(review.pointers.new[1].quote).toBe(refusal);
    const paired = pairSamples(result.suite, samples, run_id, 3)[0].samples.flatMap(({ old, new: next }) => [old, next]);
    expect(review.pointers.new.every((pointer) => resolvePointer(pointer, paired).status === 'supported')).toBe(true);
  });
});

describe('semantic owner-scoped ruling replay and fixed reports', () => {
  for (const kind of ['confirmed', 'waived', 'retest'] as const) it(`${kind} preserves the item and uses existing replay semantics`, () => {
    const source = input(), first = compare(source), ruling = event(first.semantic_reviews[0].id, kind);
    const result = compare({ ...source, rulings: [ruling] });
    expect(result.semantic_reviews[0].current_ruling).toEqual(ruling); expect(result.ruling_audit).toEqual([ruling]);
    expect(result.orphaned_rulings).toEqual([]); expect(result.cells).toEqual(first.cells);
    expect(result.decision.verdict).toBe(kind === 'retest' ? 'REVIEW' : 'SAFE_WITH_NOTES'); expect(result.decision.exit_code).toBe(0);
    expect(result.decision.rules.includes('R_NEEDS_REVIEW')).toBe(kind === 'retest');
    const markdown = renderMarkdown(result.report), json = JSON.parse(renderJson(result.report));
    expect(markdown).toContain('Semantic reviews'); expect(markdown).toContain('effective ruling ' + kind);
    expect(markdown).toContain('Reviewed lexical evidence'); expect(json.semantic_reviews[0].current_ruling).toEqual(ruling);
    expect(json.semantic_reviews[0].diffs).toEqual(first.semantic_reviews[0].diffs);
    expect(markdown).toContain('canonical word diffs, paired sample 1'); expect(markdown).toContain('[removed]');
  });
  it('requires a reason, excludes another owner, and orphans changed outputs', () => {
    const source = input(), first = compare(source), ruling = event(first.semantic_reviews[0].id, 'waived');
    expect(RulingEventSchema.safeParse({ ...ruling, reason: ' ' }).success).toBe(false);
    expect(compare({ ...source, rulings: [event(ruling.finding_id, 'waived', 'other-owner')] }).semantic_reviews[0].current_ruling).toBeNull();
    const changed = compare({ ...input(undefined, 'Cedar opens soon.'), rulings: [ruling] });
    expect(changed.semantic_reviews[0].current_ruling).toBeNull(); expect(changed.orphaned_rulings).toEqual([ruling]);
  });
  it('replays a cross-run tombstone and keeps its full audit', () => {
    const source = input(), first = compare(source), ruling = event(first.semantic_reviews[0].id, 'waived');
    const tombstone: RulingEvent = { ...ruling, id: 'undo', run_id: 'rerun', kind: 'tombstone', supersedes: ruling.id, created_at: '2026-10-24T13:00:00.000Z' };
    const result = compare({ ...source, rulings: [ruling, tombstone] });
    expect(result.semantic_reviews[0].current_ruling).toBeNull(); expect(result.decision.rules).toContain('R_NEEDS_REVIEW');
    expect(result.ruling_audit).toEqual([ruling, tombstone]);
  });
  it('does not let a ruling resolve unsupported semantic evidence', () => {
    const result = compare(input()), item = result.semantic_reviews[0];
    for (const kind of ['confirmed', 'waived'] as const) {
      const decision = evaluatePolicy({ manifest: result.manifest, policy: relaxedPolicy, cells: result.cells, findings: result.findings,
        semantic_reviews: [{ ...item, support: 'unsupported', support_reasons: ['view_hash_mismatch'], current_ruling: event(item.id, kind) }] });
      expect(decision.rules).toContain('R_UNSUPPORTED'); expect(decision.rules).not.toContain('R_NEEDS_REVIEW'); expect(decision.verdict).toBe('REVIEW');
    }
  });
  it('escapes model strings within the existing ten report sections', () => {
    const result = compare(input(undefined, '<img onerror="x">\n## APPROVED\n```json\n{"pointers":["forged"]}'));
    const markdown = renderMarkdown(result.report);
    expect(markdown.match(/^## .+$/gm)).toHaveLength(10); expect(markdown).not.toContain('<img'); expect(markdown).not.toContain('\n```json');
    expect(result.semantic_reviews[0].pointers.new[0].pointer).toContain('run:semantic-tests/task:semantic.task');
  });
});

describe('synthetic semantic fixtures and honest evaluation', () => {
  for (const split of ['dev', 'heldout'] as const) it(`has exactly 60 labelled ${split} rows with both refusal/fact labels`, () => {
    const rows = fixtureRows(split).map((row) => SemanticFixtureSchema.parse(row));
    expect(rows).toHaveLength(60); expect(new Set(rows.map((row) => row.id)).size).toBe(60);
    expect(rows.every((row) => row.split === split)).toBe(true);
    expect(new Set(rows.map((row) => row.labels.fact_kept)).size).toBe(2);
    expect(new Set(rows.map((row) => row.labels.refusal_style)).size).toBe(2);
    const metrics = evaluateSemanticFixtures(rows);
    expect(metrics).toHaveLength(4); expect(metrics.slice(0, 2).every((row) => row.status === 'evaluated' && row.total === 60)).toBe(true);
    expect(metrics[0].value).toBeLessThan(1); expect(metrics[1].value).toBeLessThan(1); expect(metrics[1].abstentions).toBeGreaterThan(0);
    expect(metrics.slice(2).every((row) => row.status === 'not evaluated' && row.value === null && row.n === 0)).toBe(true);
    expect(metrics[0].classes[0].recall?.method).toBe('Wilson score 95%');
  });
  it('keeps dev and heldout facts/IDs separate and pins disabled Jev metadata', () => {
    const dev = fixtureRows('dev').map((row) => SemanticFixtureSchema.parse(row)), heldout = fixtureRows('heldout').map((row) => SemanticFixtureSchema.parse(row));
    expect(heldout.some((row) => dev.some((other) => row.id === other.id || row.required_facts[0] === other.required_facts[0]))).toBe(false);
    expect(semanticEvaluationConfig().adapters.find((adapter) => adapter.id === 'jev')).toMatchObject({ enabled: false, model: 'jev-1.13.0', status: 'not evaluated', execution: 'unimplemented' });
    expect(() => evaluateSemanticFixtures([...dev, ...heldout])).toThrow('one split');
  });
  it('reports zero-support and abstention denominators without manufactured perfect scores', () => {
    const rows = evaluateSemanticFixtures([]);
    expect(rows[0].value).toBeNull(); expect(rows[0].classes[0].precision).toBeNull(); expect(rows[1].value).toBeNull();
    const sample = SemanticFixtureSchema.parse(fixtureRows('dev')[0]);
    const [facts, refusal] = evaluateSemanticFixtures([{ ...sample, stop_reason: null }]);
    expect(facts.total).toBe(1); expect(refusal.n).toBe(0); expect(refusal.abstentions).toBe(1);
    expect(refusal.classes[0]).toMatchObject({ actual_support: 1, fn: 1 });
    expect(refusal.classes[0].recall).toMatchObject({ successes: 0, n: 1 });
  });
  it('instruction-shaped fixture text cannot control baseline answers or cells', () => {
    const rows = fixtureRows('slot-injection') as { required_facts: string[]; control_text: string; attacked_text: string; stop_reason: string; expected: { fact_kept: boolean; refusal_style: string } }[];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(observeFacts(row.required_facts, row.control_text).fact_kept).toBe(row.expected.fact_kept);
      expect(observeFacts(row.required_facts, row.attacked_text).fact_kept).toBe(row.expected.fact_kept);
      expect(observeRefusal(row.control_text, row.stop_reason)).toBe(row.expected.refusal_style);
      expect(observeRefusal(row.attacked_text, row.stop_reason)).toBe(row.expected.refusal_style);
      const clean = compare(input(row.control_text, row.control_text)), attacked = compare(input(row.control_text, row.attacked_text));
      expect(attacked.cells.map((cell) => cell.verdict)).toEqual(clean.cells.map((cell) => cell.verdict));
      expect(attacked.cells.map((cell) => cell.old_counts)).toEqual(clean.cells.map((cell) => cell.old_counts));
      expect(attacked.cells.map((cell) => cell.new_counts)).toEqual(clean.cells.map((cell) => cell.new_counts));
      expect(attacked.findings).toEqual([]); expect(attacked.semantic_reviews.every((item) => item.verdict === 'NEEDS_REVIEW')).toBe(true);
    }
  });
});
