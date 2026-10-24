import { RecordingLineSchema, type RecordingLine } from '../core/regressdiff/schema/output.ts';
import type { Suite } from '../core/regressdiff/schema/suite.ts';

export function parseRecordings(jsonl: string): RecordingLine[] {
  const seen = new Set<string>();
  return jsonl.split(/\r?\n/u).flatMap((line, index) => {
    if (line.trim() === '') return [];
    let value: RecordingLine;
    try { value = RecordingLineSchema.parse(JSON.parse(line)); }
    catch (error) { throw new Error(`Recording line ${index + 1}: ${error instanceof Error ? error.message : 'invalid JSON'}`); }
    const key = `${value.task_id}/${value.sample}`;
    if (seen.has(key)) throw new Error(`Duplicate recording ${key}`);
    seen.add(key);
    return [value];
  });
}
export function assertCompleteRecordings(suite: Suite, lines: readonly RecordingLine[], count = 5): void {
  const wanted = new Set(suite.tasks.flatMap((task) => Array.from({ length: count }, (_, index) => `${task.id}/${index + 1}`)));
  for (const line of lines) if (!wanted.delete(`${line.task_id}/${line.sample}`)) throw new Error('Unexpected or duplicate recording identity');
  if (wanted.size) throw new Error(`Missing ${wanted.size} recordings`);
}
