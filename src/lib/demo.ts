import suiteJson from '../../fixtures/suite.demo.json';
import oldJsonl from '../../fixtures/recordings/old.jsonl?raw';
import newJsonl from '../../fixtures/recordings/new.jsonl?raw';
import modelsJson from '../../supabase/functions/run-task/portable/models.json';
import { ModelsSchema } from '../core/regressdiff/schema/models.ts';
import { SuiteSchema, type Suite } from '../core/regressdiff/schema/suite.ts';
import type { RunArgs } from '../core/regressdiff/schema/manifest.ts';
import { createMockProvider } from '../core/providers/mock.ts';
import { compare } from '../core/regressdiff/compare.ts';
import { parseRecordings, assertCompleteRecordings } from './recordings.ts';
import type { Store } from './store/types.ts';

export const demoSuite = SuiteSchema.parse(suiteJson);
export const demoModels = ModelsSchema.parse(modelsJson);
const recordings = { old: parseRecordings(oldJsonl), new: parseRecordings(newJsonl) };
assertCompleteRecordings(demoSuite, recordings.old);
assertCompleteRecordings(demoSuite, recordings.new);
export const demoProvider = createMockProvider(demoSuite, recordings);
export interface DemoProgress { completed: number; total: number }
export async function runDemo(suite: Suite, args: RunArgs, store: Store,
  onProgress: (progress: DemoProgress) => void = () => {}, yieldControl: () => Promise<void> = async () => {},
) {
  const run = await store.createRun(suite, args), total = suite.tasks.length * 2 * args.k;
  let completed = 0;
  onProgress({ completed, total });
  for (const task of suite.tasks) for (const side of ['old', 'new'] as const) for (let sample = 1; sample <= args.k; sample++) {
    await store.addSample(demoProvider.replay(run.id, task, side, sample));
    onProgress({ completed: ++completed, total });
    await yieldControl();
  }
  return { run, comparison: compare({ suite, args, samples: await store.listSamples(run.id), run_id: run.id,
    owner_id: run.owner_id, manifest: run.manifest, rulings: await store.listRulings() }) };
}
