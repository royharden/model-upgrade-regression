import { IdSchema, type Suite, type Task } from './schema/suite.ts';
import { KSchema } from './schema/manifest.ts';
import { RecordingLineSchema, type RecordingLine } from './schema/output.ts';
import { hashError, hashOutput } from './hash.ts';

export type Side = 'old' | 'new';
export type Sample = RecordingLine & { run_id: string; side: Side; output_sha256: string };
export interface SamplePair { sample: number; old: Sample; new: Sample }
export interface TaskPair { task: Task; samples: SamplePair[] }
export function makeSample(run_id: string, side: Side, line: RecordingLine): Sample {
  IdSchema.parse(run_id);
  if (side !== 'old' && side !== 'new') throw new Error('Invalid sample side');
  const valid = RecordingLineSchema.parse(line);
  return { ...valid, run_id, side, output_sha256: valid.output ? hashOutput(valid.output) : hashError(valid.error ?? 'missing error') };
}
export function pairSamples(suite: Suite, samples: readonly Sample[], run_id: string, k: 1 | 3 | 5): TaskPair[] {
  KSchema.parse(k);
  const taskIds = new Set(suite.tasks.map((task) => task.id));
  const indexed = new Map<string, Sample>();
  for (const sample of samples) {
    if (sample.run_id !== run_id || !taskIds.has(sample.task_id) || !['old', 'new'].includes(sample.side)) throw new Error('Sample identity is outside requested run/suite');
    const valid = makeSample(run_id, sample.side, { task_id: sample.task_id, sample: sample.sample, output: sample.output,
      ...(sample.raw !== undefined ? { raw: sample.raw } : {}), ...(sample.error !== undefined ? { error: sample.error } : {}) });
    if (valid.output_sha256 !== sample.output_sha256) throw new Error('Sample output hash mismatch');
    const key = `${sample.task_id}/${sample.side}/${sample.sample}`;
    if (indexed.has(key)) throw new Error(`Duplicate sample ${key}`);
    indexed.set(key, sample);
  }
  return suite.tasks.map((task) => ({ task, samples: Array.from({ length: k }, (_, index) => {
    const sample = index + 1;
    const get = (side: Side) => indexed.get(`${task.id}/${side}/${sample}`) ?? makeSample(run_id, side, {
      task_id: task.id, sample, output: null, error: 'missing_sample',
    });
    return { sample, old: get('old'), new: get('new') };
  }) }));
}
