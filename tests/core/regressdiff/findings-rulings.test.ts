import { describe, expect, it } from 'vitest';
import { demoSuite, runDemo } from '../../../src/lib/demo.ts';
import { MemoryStore } from '../../../src/lib/store/memory.ts';
import { compare } from '../../../src/core/regressdiff/compare.ts';
import { findingId } from '../../../src/core/regressdiff/findings.ts';
import { hashOutput } from '../../../src/core/regressdiff/hash.ts';
import { replayRulings, type RulingEvent } from '../../../src/core/regressdiff/rulings.ts';
import { sortFindings } from '../../../src/core/regressdiff/sort.ts';

const args = { k: 3, old_model: 'mock:old', new_model: 'mock:new' } as const;
const event = (finding_id: string, changes: Partial<RulingEvent> = {}): RulingEvent => ({
  id: 'event-1', owner_id: 'demo-session', run_id: 'demo-run-1', finding_id, kind: 'waived', reason: 'Reviewed synthetic case',
  created_at: '2026-10-24T12:00:00.000Z', supersedes: null, ...changes,
});
describe('finding identity', () => {
  it('is stable across reruns/model aliases with identical evidence and changes for check/output/engine changes', async () => {
    const { comparison } = await runDemo(demoSuite, args, new MemoryStore());
    const cell = comparison.cells.find((value) => value.task_id === 'tool.args')!, id = findingId(cell);
    expect(findingId({ ...cell, old_results: cell.old_results.map((result) => ({ ...result, sample: { ...result.sample, run_id: 'other-run' } })) })).toBe(id);
    expect(findingId({ ...cell, check: { ...cell.check, params: { name: 'transfer', expected: { amount: 11, currency: 'USD' } } } })).not.toBe(id);
    expect(findingId(cell, { normalisation: 'normalisation-v2', verdict: 'verdict-rule-v1' })).not.toBe(id);
    expect(findingId(cell, { normalisation: 'normalisation-v1', verdict: 'verdict-rule-v2' })).not.toBe(id);
    const changed = cell.new_results.map((value, index) => ({ ...value, sample: { ...value.sample, output_sha256: index === 0 ? 'a'.repeat(64) : value.sample.output_sha256 } }));
    expect(findingId({ ...cell, new_results: changed })).not.toBe(id);
  });
  it('changes for tool-order-only differences even when sorted tool_calls are identical', async () => {
    const { comparison } = await runDemo(demoSuite, args, new MemoryStore());
    const cell = comparison.cells.find((value) => value.task_id === 'tool.independent')!;
    const changed = cell.new_results.map((value) => {
      const output = value.sample.output!;
      const reordered = { ...output, tool_calls_original: [...output.tool_calls_original].reverse() };
      return { ...value, sample: { ...value.sample, output: reordered, output_sha256: hashOutput(reordered) } };
    });
    expect(changed[0].sample.output?.tool_calls).toEqual(cell.new_results[0].sample.output?.tool_calls);
    expect(findingId({ ...cell, new_results: changed })).not.toBe(findingId(cell));
  });
  it('binds ordered error hash vectors and k without dropping error samples', async () => {
    const { comparison } = await runDemo(demoSuite, args, new MemoryStore());
    const cell = comparison.cells.find((value) => value.task_id === 'con.error')!;
    expect(cell.old_results[1].result.status).toBe('error');
    expect(findingId({ ...cell, old_results: [...cell.old_results].reverse() })).not.toBe(findingId(cell));
    expect(findingId({ ...cell, old_results: [cell.old_results[0]], new_results: [cell.new_results[0]] })).not.toBe(findingId(cell));
  });
});
describe('finding order', () => {
  it.each([false, true])('ties non-regression findings by task ID instead of check family (retest=%s)', async (retest) => {
    const { comparison } = await runDemo(demoSuite, args, new MemoryStore());
    const improved = comparison.findings.filter((finding) => finding.verdict === 'IMPROVED')
      .map((finding) => retest ? { ...finding, current_ruling: event(finding.id, { kind: 'retest' }) } : finding);
    // contains sorts before equals by family, while sem sorts after fmt by task ID.
    expect(sortFindings([...improved].reverse()).map((finding) => finding.task_id))
      .toEqual(['fmt.exact-improved', 'len.improved', 'ref.safe-phrase', 'sem.fact-improved']);
    const exact = improved.find((finding) => finding.task_id === 'fmt.exact-improved')!;
    const fact = improved.find((finding) => finding.task_id === 'sem.fact-improved')!;
    expect(sortFindings([{ ...fact, task_id: 'same-task', check_id: 'z' }, { ...exact, task_id: 'same-task', check_id: 'a' }])
      .map((finding) => finding.check_id)).toEqual(['a', 'z']);
  });
  it('retains regression-family, always-blocking and explicit block-causing priorities', async () => {
    const { comparison } = await runDemo(demoSuite, args, new MemoryStore());
    const tasks = ['tool.args', 'con.thinking', 'tool.order', 'fmt.prefix', 'tool.forbidden'];
    const regressions = comparison.findings.filter((finding) => tasks.includes(finding.task_id));
    expect(regressions.every((finding) => finding.verdict === 'REGRESSED')).toBe(true);
    expect(sortFindings(regressions).map((finding) => finding.task_id))
      .toEqual(['tool.forbidden', 'tool.order', 'fmt.prefix', 'con.thinking', 'tool.args']);
    const argsFinding = regressions.find((finding) => finding.task_id === 'tool.args')!;
    expect(sortFindings(regressions, undefined, new Set([argsFinding.id])).map((finding) => finding.task_id))
      .toEqual(['tool.args', 'tool.forbidden', 'tool.order', 'fmt.prefix', 'con.thinking']);
  });
});

describe('owner-scoped insert-only ruling replay', () => {
  const id = 'a'.repeat(64), nextId = 'b'.repeat(64);
  it('replays same-owner identical finding across runs, preserving the full audit', () => {
    const original = event(id), latest = event(id, { id: 'event-2', run_id: 'demo-run-2', kind: 'confirmed', created_at: '2026-10-24T12:01:00.000Z' });
    const foreign = event(id, { id: 'foreign', owner_id: 'someone-else', kind: 'retest' });
    const result = replayRulings('demo-session', [id], [latest, original, foreign]);
    expect(result.effective[id].kind).toBe('confirmed');
    expect(result.audit).toHaveLength(2);
    expect(result.orphaned).toHaveLength(0);
  });
  it('retains orphan events when output/check/engine identity changes', () => {
    const ruling = event(id);
    const result = replayRulings('demo-session', [nextId], [ruling]);
    expect(result.effective[nextId]).toBeUndefined();
    expect(result.orphaned).toEqual([ruling]);
    expect(result.audit).toEqual([ruling]);
  });
  it('tombstones supersede a targeted event and reveal the next newest remaining event', () => {
    const first = event(id), second = event(id, { id: 'event-2', kind: 'retest', created_at: '2026-10-24T12:01:00.000Z' });
    const tombstone = event(id, { id: 'event-3', kind: 'tombstone', supersedes: second.id, created_at: '2026-10-24T12:02:00.000Z' });
    expect(replayRulings('demo-session', [id], [first, second, tombstone]).effective[id]).toEqual(first);
    const unTombstone = event(id, { id: 'event-4', kind: 'tombstone', supersedes: tombstone.id, created_at: '2026-10-24T12:03:00.000Z' });
    expect(replayRulings('demo-session', [id], [first, second, tombstone, unTombstone]).effective[id]).toEqual(second);
  });
  it('rejects blank reasons, duplicate ids and cross-finding/absent tombstone targets', () => {
    expect(() => replayRulings('demo-session', [id], [event(id, { reason: '  ' })])).toThrow();
    expect(() => replayRulings('demo-session', [id], [event(id), event(id)])).toThrow();
    expect(() => replayRulings('demo-session', [id], [event(id), event(nextId, { id: 'event-2', kind: 'tombstone', supersedes: 'event-1', created_at: '2026-10-24T12:01:00.000Z' })])).toThrow();
    expect(() => replayRulings('demo-session', [id], [event(id, { kind: 'tombstone', supersedes: 'missing' })])).toThrow();
  });
  it('keeps waived findings listed in original order without changing sample evidence', async () => {
    const store = new MemoryStore(), { comparison, run } = await runDemo(demoSuite, args, store);
    const first = comparison.findings[0], samplesBefore = store.listSamples(run.id);
    store.addRuling(event(first.id));
    const replayed = compare({ suite: demoSuite, args, samples: store.listSamples(run.id), run_id: run.id, owner_id: store.owner_id,
      manifest: run.manifest, rulings: store.listRulings() });
    expect(replayed.findings.map((finding) => finding.id)).toEqual(comparison.findings.map((finding) => finding.id));
    expect(replayed.findings[0].current_ruling?.kind).toBe('waived');
    expect(replayed.findings[0].original_severity).toBe('REGRESSED');
    expect(store.listSamples(run.id)).toEqual(samplesBefore);
  });
  it('elevates unresolved retest without demoting the original regression severity', async () => {
    const { comparison } = await runDemo(demoSuite, args, new MemoryStore());
    const improved = comparison.findings.find((finding) => finding.verdict === 'IMPROVED')!;
    const modified = comparison.findings.map((finding) => finding.id === improved.id ? { ...finding, current_ruling: event(finding.id, { kind: 'retest' }) } : finding);
    const sorted = sortFindings(modified);
    expect(sorted.findIndex((finding) => finding.id === improved.id)).toBeLessThan(sorted.findIndex((finding) => finding.verdict === 'WITHIN_NOISE'));
    expect(sorted[0].check_type).toBe('tool_forbidden');
    expect(sorted.find((finding) => finding.id === improved.id)?.original_severity).toBe('IMPROVED');
  });
});
