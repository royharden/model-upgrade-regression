import { describe, expect, it } from 'vitest';
import { demoSuite, demoProvider } from '../../../src/lib/demo.ts';
import { MemoryStore } from '../../../src/lib/store/memory.ts';
import { pairSamples } from '../../../src/core/regressdiff/pairing.ts';
import { parseRecordings, assertCompleteRecordings } from '../../../src/lib/recordings.ts';
import { compare } from '../../../src/core/regressdiff/compare.ts';

const args = { k: 3, old_model: 'mock:old', new_model: 'mock:new' } as const;
describe('pairing and recording boundaries', () => {
  it('fills missing samples with errors at the original k', () => {
    const store = new MemoryStore(), run = store.createRun(demoSuite, args);
    const result = compare({ suite: demoSuite, args, run_id: run.id, owner_id: store.owner_id, samples: [] });
    expect(result.cells).toHaveLength(40);
    expect(result.cells.every((cell) => cell.verdict === 'COULD_NOT_JUDGE' && cell.error_counts.old === 3 && cell.error_counts.new === 3)).toBe(true);
  });
  it('rejects duplicate, foreign or tampered sample identities', () => {
    const sample = demoProvider.replay('run', demoSuite.tasks[0], 'old', 1);
    expect(() => pairSamples(demoSuite, [sample, sample], 'run', 3)).toThrow('Duplicate');
    expect(() => pairSamples(demoSuite, [{ ...sample, run_id: 'foreign' }], 'run', 3)).toThrow('identity');
    expect(() => pairSamples(demoSuite, [{ ...sample, output_sha256: '0'.repeat(64) }], 'run', 3)).toThrow('hash');
  });
  it('pairs in sample index order and selects samples 1..k from five recordings', () => {
    const task = demoSuite.tasks[0], values = [5, 2, 4, 1, 3].flatMap((index) => ['old', 'new'].map((side) => demoProvider.replay('run', task, side as 'old' | 'new', index)));
    const pairs = pairSamples({ ...demoSuite, tasks: [task] }, values, 'run', 3);
    expect(pairs[0].samples.map((pair) => pair.sample)).toEqual([1, 2, 3]);
    expect(pairs[0].samples.every((pair) => pair.old.output && pair.new.output)).toBe(true);
  });
  it('does not mislabel recordings from an edited prompt as answers to that prompt', () => {
    const task = { ...demoSuite.tasks[0], messages: [{ role: 'user' as const, content: 'A different request' }] };
    const result = demoProvider.replay('run', task, 'new', 1);
    expect(result.output).toBeNull();
    expect(result.error).toBe('no_recording_for_exact_task_configuration');
  });
  it('reports JSONL line errors and duplicates; completeness includes errors as samples', () => {
    expect(() => parseRecordings('not json')).toThrow('line 1');
    const line = '{"task_id":"t","sample":1,"output":null,"error":"recorded"}';
    expect(parseRecordings(`\n${line}\r\n`)).toHaveLength(1);
    expect(() => parseRecordings(`${line}\n${line}`)).toThrow('Duplicate');
    expect(() => assertCompleteRecordings({ ...demoSuite, tasks: [demoSuite.tasks[0]] }, [])).toThrow('Missing');
  });
});
describe('session memory stores immutable source evidence only', () => {
  it('returns isolated copies and refuses changing an existing suite id', () => {
    const store = new MemoryStore();
    store.saveSuite(demoSuite);
    const copy = store.getSuite(demoSuite.id)!;
    copy.name = 'Changed';
    expect(store.getSuite(demoSuite.id)?.name).toBe(demoSuite.name);
    expect(() => store.saveSuite({ ...demoSuite, name: 'Changed' })).toThrow('immutable');
  });
  it('accepts identical sample replay but refuses replacing evidence', () => {
    const store = new MemoryStore(), run = store.createRun(demoSuite, args);
    const sample = demoProvider.replay(run.id, demoSuite.tasks[0], 'old', 1);
    store.addSample(sample); store.addSample(sample);
    expect(store.listSamples(run.id)).toHaveLength(1);
    const changed = { ...sample, raw: { changed: true } };
    expect(() => store.addSample(changed)).toThrow('immutable');
    const returned = store.listSamples(run.id);
    returned[0].task_id = 'changed';
    expect(store.listSamples(run.id)[0].task_id).toBe(sample.task_id);
    expect(Object.keys(store.getRun(run.id)!)).not.toContain('cells');
  });
});
