import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import suiteJson from '../../fixtures/suite.demo.json';
import { assertHeldoutUnused, GENERATED_START, GENERATED_END, main, parseEvalArgs, parseSemanticFixtureRows, updateGeneratedBlock, type EvalIO, type HeldoutEvent } from '../../cli/eval.ts';

const readme = `Authored introduction\n${GENERATED_START}\nnot yet measured\n${GENERATED_END}\nAuthored footer`;
function fakeIO(failWrite = false) {
  const portable = (path: string) => path.replace(/\\/gu, '/');
  const files: Record<string, string> = { 'fixtures/suite.demo.json': JSON.stringify(suiteJson),
    'fixtures/recordings/old.jsonl': readFileSync(new URL('../../fixtures/recordings/old.jsonl', import.meta.url), 'utf8'),
    'fixtures/semantic/dev.jsonl': readFileSync(new URL('../../fixtures/semantic/dev.jsonl', import.meta.url), 'utf8'),
    'fixtures/semantic/heldout.jsonl': readFileSync(new URL('../../fixtures/semantic/heldout.jsonl', import.meta.url), 'utf8'),
    'results/README.md': readme, 'README.md': readme };
  const stdout: string[] = [], stderr: string[] = [], events: string[] = [], reservations = new Set<string>();
  const append = (path: string, event: HeldoutEvent) => { files[path] = (files[path] ?? '') + JSON.stringify(event) + '\n'; events.push(event.status); };
  const io: EvalIO = { readText: async (path) => { const key = portable(path); if (!(key in files)) throw new Error(`Missing ${path}`); return files[key]; },
    readOptional: async (path) => files[portable(path)] ?? null, ensureDirectory: async () => {}, now: () => '2026-10-24T00:00:00.000Z',
    writeText: async (path, text) => { const key = portable(path); events.push(`write:${key}`); if (failWrite) throw new Error('test write failure'); files[key] = text; },
    reserveHeldout: async (path, event) => { assertHeldoutUnused(files[path] ?? '', event.key); if (reservations.has(event.key)) throw new Error('Already reserved'); reservations.add(event.key); append(path, event); },
    appendHeldout: async (path, event) => { append(path, event); }, stdout: (text) => { events.push('stdout'); stdout.push(text); }, stderr: (text) => { stderr.push(text); } };
  return { io, files, stdout, stderr, events };
}
describe('eval CLI uses explicit IO and a once-per-version/config held-out guard', () => {
  it('defaults to dev and has no IO on help or invalid flags', async () => {
    expect(parseEvalArgs([])).toMatchObject({ heldout: false, seed: 40, out: 'results' });
    const fake = fakeIO(); expect(await main(['--help'], fake.io)).toBe(0);
    expect(fake.events).toEqual(['stdout']); expect(fake.files['results/heldout-run.log']).toBeUndefined();
    expect(await main(['--seed', '-1'], fake.io)).toBe(2); expect(fake.events).toEqual(['stdout']);
  });
  it('writes actual dev report rows and only generated README blocks after support is printed', async () => {
    const fake = fakeIO(); expect(await main([], fake.io)).toBe(0);
    expect(fake.stdout[0]).toContain('## Class support'); expect(fake.stdout[0]).not.toContain('## Metrics');
    const summary = JSON.parse(fake.files['results/results.jsonl'].split('\n')[0]);
    expect(summary).toMatchObject({ type: 'summary', partition: 'dev' });
    expect(summary.metrics).toHaveLength(10); expect(summary.semantic.jev).toContain('not evaluated');
    expect(summary.semantic_evaluation.map((row: { id: string; status: string }) => [row.id, row.status])).toEqual([
      ['key-token-facts', 'evaluated'], ['refusal-style', 'evaluated'], ['generative-judge', 'not evaluated'], ['jev', 'not evaluated']]);
    expect(summary.semantic_evaluation[0].total).toBe(60); expect(summary.semantic_evaluation[0].classes[0]).toHaveProperty('actual_support');
    expect(summary.semantic_fixture_sha256.dev).toMatch(/^[a-f0-9]{64}$/u); expect(summary.semantic_configuration.facts.version).toBeTruthy();
    expect(fake.files['results/results.md']).toContain('| Actual support | Predicted support |');
    expect(fake.files['results/results.md']).toContain('refusal macro-F1'); expect(fake.files['results/results.md']).toContain('Status: not evaluated');
    expect(fake.files['README.md']).toContain('Authored introduction'); expect(fake.files['README.md']).toContain('Authored footer');
    expect(fake.files['results/README.md']).toContain(fake.files['results/results.md'].trim());
    expect(fake.files['results/heldout-run.log']).toBeUndefined();
  }, 60_000);
  it('reserves before any result write, logs completion afterward and refuses repeated config even with another output directory', async () => {
    const fake = fakeIO(); expect(await main(['--heldout'], fake.io)).toBe(0);
    expect(fake.events.indexOf('started')).toBeLessThan(fake.events.findIndex((event) => event.startsWith('write:')));
    expect(fake.events.indexOf('completed')).toBeGreaterThan(fake.events.findIndex((event) => event.startsWith('write:')));
    const before = fake.files['results/results.jsonl'];
    expect(await main(['--heldout', '--out', 'other-results'], fake.io)).toBe(2);
    expect(fake.files['results/results.jsonl']).toBe(before); expect(fake.files['other-results/results.jsonl']).toBeUndefined();
    expect(fake.files['results/heldout-run.log'].trim().split('\n').map((line) => JSON.parse(line).status)).toEqual(['started', 'completed']);
    expect(fake.stderr.join('')).toContain('already attempted');
  }, 60_000);
  it('retains a failed attempt and never retries it', async () => {
    const fake = fakeIO(true); expect(await main(['--heldout'], fake.io)).toBe(2);
    expect(fake.files['results/heldout-run.log'].trim().split('\n').map((line) => JSON.parse(line).status)).toEqual(['started', 'failed']);
    const events = fake.events.length;
    expect(await main(['--heldout'], fake.io)).toBe(2);
    expect(fake.events.slice(events).some((event) => event.startsWith('write:'))).toBe(false);
  }, 60_000);
  it('rejects malformed log and consumes started, completed and failed entries', () => {
    expect(() => assertHeldoutUnused('{bad', 'key')).toThrow('Malformed');
    expect(() => assertHeldoutUnused('{}', 'key')).toThrow('Invalid');
    for (const status of ['started', 'completed', 'failed']) expect(() => assertHeldoutUnused(JSON.stringify({ key: 'key', status }), 'key')).toThrow('already attempted');
    expect(() => assertHeldoutUnused(JSON.stringify({ key: 'other', status: 'completed' }), 'key')).not.toThrow();
  });
  it('binds both semantic fixture hashes and baseline versions into configuration identity while evaluating only the selected split', async () => {
    const first = fakeIO(), changed = fakeIO();
    changed.files['fixtures/semantic/heldout.jsonl'] += '\n';
    expect(await main([], first.io)).toBe(0); expect(await main([], changed.io)).toBe(0);
    const left = JSON.parse(first.files['results/results.jsonl'].split('\n')[0]);
    const right = JSON.parse(changed.files['results/results.jsonl'].split('\n')[0]);
    expect(left.config_sha256).not.toBe(right.config_sha256);
    expect(left.semantic_evaluation).toEqual(right.semantic_evaluation);
    expect(left.semantic_fixture_sha256.heldout).not.toBe(right.semantic_fixture_sha256.heldout);
    expect(first.stdout[0]).toContain('generative judge and Jev: not evaluated');
  }, 60_000);
  it('rejects a mislabeled or duplicate semantic input partition before result writes', async () => {
    const fake = fakeIO();
    expect(() => parseSemanticFixtureRows(fake.files['fixtures/semantic/heldout.jsonl'], 'dev')).toThrow('selected dev');
    const row = fake.files['fixtures/semantic/dev.jsonl'].split('\n')[0];
    expect(() => parseSemanticFixtureRows(`${row}\n${row}`, 'dev')).toThrow('Duplicate');
    fake.files['fixtures/semantic/dev.jsonl'] = fake.files['fixtures/semantic/heldout.jsonl'];
    expect(await main([], fake.io)).toBe(2); expect(fake.files['results/results.jsonl']).toBeUndefined();
  });
  it('refuses missing, reversed and duplicate README marker pairs', () => {
    expect(updateGeneratedBlock(readme, 'actual report')).toBe(`Authored introduction\n${GENERATED_START}\n\nactual report\n\n${GENERATED_END}\nAuthored footer`);
    for (const text of ['none', `${GENERATED_END}${GENERATED_START}`, `${readme}${GENERATED_START}`]) expect(() => updateGeneratedBlock(text, 'actual')).toThrow();
  });
});
