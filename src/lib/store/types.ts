import type { Suite } from '../../core/regressdiff/schema/suite.ts';
import type { RunArgs, RunManifest } from '../../core/regressdiff/schema/manifest.ts';
import type { Sample } from '../../core/regressdiff/pairing.ts';
import type { RulingEvent } from '../../core/regressdiff/rulings.ts';
export interface StoredRun { id: string; owner_id: string; suite: Suite; args: RunArgs; manifest: RunManifest }
export type StoreResult<T> = T | Promise<T>;
export interface Store {
  saveSuite(suite: Suite): StoreResult<void>;
  getSuite(id: string): StoreResult<Suite | undefined>;
  createRun(suite: Suite, args: RunArgs): StoreResult<StoredRun>;
  getRun(id: string): StoreResult<StoredRun | undefined>;
  addSample(sample: Sample): StoreResult<void>;
  listSamples(run_id: string): StoreResult<Sample[]>;
  addRuling(event: RulingEvent): StoreResult<void>;
  listRulings(): StoreResult<RulingEvent[]>;
}
