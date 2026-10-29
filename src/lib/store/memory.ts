import { canonical } from '../../core/regressdiff/canonical.ts';
import { createManifest } from '../../core/regressdiff/compare.ts';
import { SuiteSchema, type Suite } from '../../core/regressdiff/schema/suite.ts';
import { RunArgsSchema, type RunArgs } from '../../core/regressdiff/schema/manifest.ts';
import { makeSample, type Sample } from '../../core/regressdiff/pairing.ts';
import { replayRulings, RulingEventSchema, type RulingEvent } from '../../core/regressdiff/rulings.ts';
import type { Store, StoredRun } from './types.ts';

const copy = <T>(value: T): T => JSON.parse(canonical(value)) as T;
/** Session-scoped evidence/ruling storage. Derived cells, findings and reports are never persisted. */
export class MemoryStore implements Store {
  private suites = new Map<string, Suite>();
  private runs = new Map<string, StoredRun>();
  private samples = new Map<string, Sample>();
  private rulings: RulingEvent[] = [];
  private sequence = 0;
  readonly owner_id = 'demo-session';
  saveSuite(input: Suite): void {
    const suite = SuiteSchema.parse(input), prior = this.suites.get(suite.id);
    if (prior && canonical(prior) !== canonical(suite)) throw new Error('Suite versions are immutable: choose a new suite id');
    this.suites.set(suite.id, copy(suite));
  }
  getSuite(id: string): Suite | undefined { const suite = this.suites.get(id); return suite ? copy(suite) : undefined; }
  createRun(input: Suite, inputArgs: RunArgs): StoredRun {
    const suite = SuiteSchema.parse(input), args = RunArgsSchema.parse(inputArgs);
    this.saveSuite(suite);
    const id = `demo-run-${++this.sequence}`;
    const run: StoredRun = { id, owner_id: this.owner_id, suite, args, manifest: createManifest(suite, id, args) };
    if (run.manifest.mode !== 'demo') throw new Error('Memory demo runs require mock models');
    this.runs.set(id, copy(run));
    return copy(run);
  }
  getRun(id: string): StoredRun | undefined { const run = this.runs.get(id); return run ? copy(run) : undefined; }
  addSample(sample: Sample): void {
    const run = this.runs.get(sample.run_id);
    if (!run || !run.suite.tasks.some((task) => task.id === sample.task_id) || sample.sample > run.args.k) throw new Error('Sample outside run');
    const validated = makeSample(sample.run_id, sample.side, { task_id: sample.task_id, sample: sample.sample, output: sample.output,
      ...(sample.raw !== undefined ? { raw: sample.raw } : {}), ...(sample.error !== undefined ? { error: sample.error } : {}) });
    if (validated.output_sha256 !== sample.output_sha256) throw new Error('Sample hash mismatch');
    const key = `${sample.run_id}/${sample.task_id}/${sample.side}/${sample.sample}`, prior = this.samples.get(key);
    if (prior) {
      if (canonical(prior) !== canonical(validated)) throw new Error('Samples are immutable');
      return;
    }
    this.samples.set(key, copy(validated));
  }
  listSamples(run_id: string): Sample[] { return Array.from(this.samples.values()).filter((sample) => sample.run_id === run_id).map(copy); }
  addRuling(input: RulingEvent): void {
    const event = RulingEventSchema.parse(input);
    if (event.owner_id !== this.owner_id || !this.runs.has(event.run_id)) throw new Error('Ruling owner/run mismatch');
    // Pure replay validates event IDs, reason, chronology, and owner/finding tombstone lineage.
    replayRulings(this.owner_id, [event.finding_id], [...this.rulings, event]);
    this.rulings.push(copy(event));
  }
  listRulings(): RulingEvent[] { return this.rulings.map(copy); }
}
