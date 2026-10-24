import type { Model } from '../../../supabase/functions/run-task/portable/types.ts';
import { estimateSpend } from '../../../supabase/functions/run-task/portable/estimate.ts';
import { canonical } from '../regressdiff/canonical.ts';
import type { RecordingLine } from '../regressdiff/schema/output.ts';
import type { Suite, Task } from '../regressdiff/schema/suite.ts';
import { makeSample, type Sample, type Side } from '../regressdiff/pairing.ts';

/** Replays stored data only. Tool records have no executable counterpart. */
export function createMockProvider(catalog: Suite, recordings: { old: readonly RecordingLine[]; new: readonly RecordingLine[] }) {
  const tasks = new Map(catalog.tasks.map((task) => [task.id, canonical(task)]));
  const bySide = { old: new Map<string, RecordingLine>(), new: new Map<string, RecordingLine>() };
  for (const side of ['old', 'new'] as const) for (const line of recordings[side]) {
    const key = `${line.task_id}/${line.sample}`;
    if (bySide[side].has(key)) throw new Error('Duplicate mock recording');
    bySide[side].set(key, line);
  }
  return {
    estimate(model: Model) { return estimateSpend(model, { serialized_request: '', message_count: 0 }); },
    replay(run_id: string, task: Task, side: Side, sample: number): Sample {
      const matches = tasks.get(task.id) === canonical(task);
      const recorded = matches ? bySide[side].get(`${task.id}/${sample}`) : undefined;
      return makeSample(run_id, side, recorded ?? { task_id: task.id, sample, output: null,
        error: matches ? 'missing_fixture_recording' : 'no_recording_for_exact_task_configuration' });
    },
  };
}
export type MockProvider = ReturnType<typeof createMockProvider>;
