import { canonical } from '../canonical.ts';
import { runCheck, type CheckConfig, type CheckContext } from '../checks/index.ts';
import { sha256 } from '../hash.ts';
import { normalise } from '../normalise.ts';
import { RecordingLineSchema, type RecordingLine, type NormalisedOutput } from '../schema/output.ts';
import { SuiteSchema, type Suite, type Task } from '../schema/suite.ts';
import { benignControl, canControl } from './controls.ts';
import { canInject, cloneJson, expectedCheck, inject, TOKEN_RECOUNT_ALGORITHM } from './injectors.ts';
import { improvementPair, IMPROVEMENT_TASKS } from './improvements.ts';
import { partitionForTask, SPLIT_ALGORITHM } from './split.ts';
import { CONTROL_KINDS, INJECTOR_CLASSES, type BenchmarkData, type BenchmarkManifest, type BenchmarkOptions,
  type BenchmarkVariant, type ClassSupport, type ControlKind, type InjectorClass, type VariantMetadata } from './types.ts';

export const BENCHMARK_VERSION = 's40-planted-v1';
export const BENCHMARK_FREEZE_DATE = '2026-10-24';
export const BENCHMARK_SEED = 40;
/** Explicit fixture-only prices match mock models.json; they are never live spend. */
export const BENCHMARK_CHECK_CONTEXT: CheckContext = { check_prices: {
  currency: 'USD', input_per_mtok: 1, output_per_mtok: 4, verified_date: null, synthetic: true,
} };
const hash = (value: unknown): string => sha256(canonical(value));
const nonceFor = (seed: number, id: string, sample: number): number => Number.parseInt(sha256(`${seed}:${id}:${sample}`).slice(0, 8), 16);
function recorded(task: Task, sample: number, output: NormalisedOutput): RecordingLine { return { task_id: task.id, sample, output }; }
function normaliseRows(task: Task, rows: readonly RecordingLine[]): RecordingLine[] {
  return rows.map((line) => line.output ? recorded(task, line.sample, normalise(line.output, task)) : cloneJson(line));
}
function status(check: CheckConfig, output: NormalisedOutput): string { return runCheck(check, output, BENCHMARK_CHECK_CONTEXT).status; }
function oneTaskSuite(suite: Suite, task: Task): Suite { return { id: suite.id, name: suite.name, tasks: [cloneJson(task)] }; }
function variant(suite: Suite, task: Task, fields: Pick<BenchmarkVariant, 'id' | 'kind' | 'class_name' | 'expected_miss_reason'>,
  rawOld: RecordingLine[], rawNew: RecordingLine[], check: CheckConfig | null): BenchmarkVariant {
  return { ...fields, task_id: task.id, partition: partitionForTask(task.id), expected_check_type: check?.type ?? null,
    expected_check_id: check?.id ?? null, suite: oneTaskSuite(suite, task), raw_old: cloneJson(rawOld), raw_new: cloneJson(rawNew),
    old: normaliseRows(task, rawOld), new: normaliseRows(task, rawNew) };
}
function supportInventory(variants: readonly BenchmarkVariant[]): ClassSupport[] {
  const rows: { kind: BenchmarkVariant['kind']; class_name: InjectorClass | ControlKind }[] = [
    ...INJECTOR_CLASSES.map((class_name) => ({ kind: 'planted' as const, class_name })),
    ...CONTROL_KINDS.map((class_name) => ({ kind: 'control' as const, class_name })),
    ...INJECTOR_CLASSES.map((class_name) => ({ kind: 'improvement' as const, class_name })),
  ];
  return rows.map(({ kind, class_name }) => {
    const partition = (name: 'dev' | 'heldout'): ClassSupport['dev'] => {
      const selected = variants.filter((item) => item.kind === kind && item.class_name === class_name && item.partition === name);
      return { variants: selected.length, task_ids: [...new Set(selected.map((item) => item.task_id))].sort(),
        status: selected.length ? 'supported' : 'not evaluated' };
    };
    return { kind, class_name, dev: partition('dev'), heldout: partition('heldout') };
  });
}
function metadata(item: BenchmarkVariant): VariantMetadata {
  return { id: item.id, base_task_id: item.task_id, partition: item.partition, kind: item.kind, class_name: item.class_name,
    expected_check_type: item.expected_check_type, expected_check_id: item.expected_check_id, expected_miss_reason: item.expected_miss_reason,
    base_task_sha256: hash(item.suite.tasks[0]), variant_sha256: hash(item), old_sha256: hash(item.old), new_sha256: hash(item.new),
    raw_old_sha256: hash(item.raw_old), raw_new_sha256: hash(item.raw_new) };
}
/**
 * Frozen source-defined manifest builder. Only old-side recordings are accepted; independently authored demo new.jsonl is not an input.
 * Compatibility guards verify intent while building, never add checks or silently claim missing support.
 */
export function buildBenchmark(sourceSuite: Suite, oldLines: readonly RecordingLine[], options: BenchmarkOptions = {}): BenchmarkData {
  const suite = SuiteSchema.parse(sourceSuite), seed = options.seed ?? BENCHMARK_SEED, freeze_date = options.freeze_date ?? BENCHMARK_FREEZE_DATE;
  if (!Number.isSafeInteger(seed)) throw new Error('Benchmark seed must be a safe integer');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(freeze_date)) throw new Error('Benchmark freeze date must be YYYY-MM-DD');
  const tasks = [...suite.tasks].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rows = oldLines.map((line) => RecordingLineSchema.parse(line)).sort((a, b) => a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : a.sample - b.sample);
  const taskIds = new Set(tasks.map((task) => task.id)), identities = new Set<string>();
  for (const row of rows) {
    const identity = `${row.task_id}/${row.sample}`;
    if (!taskIds.has(row.task_id) || identities.has(identity)) throw new Error(`Unexpected or duplicate benchmark recording ${identity}`);
    identities.add(identity);
  }
  if (rows.length !== tasks.length * 5) throw new Error('Benchmark requires exactly five old recordings per task');
  const byTask = new Map(tasks.map((task) => [task.id, rows.filter((line) => line.task_id === task.id)]));
  for (const task of tasks) if (byTask.get(task.id)?.length !== 5) throw new Error(`Missing old recordings for ${task.id}`);
  const excluded_tasks: BenchmarkManifest['excluded_tasks'] = tasks.flatMap((task) => {
    const errors = byTask.get(task.id)!.filter((line) => line.output === null).map((line) => line.sample);
    return errors.length ? [{ task_id: task.id, reason: 'Recorded old-side error; never converted to a planted regression or dropped from an evaluated denominator',
      expected_accounting: 'COULD_NOT_JUDGE' as const, error_samples: errors }] : [];
  });
  const excluded = new Set(excluded_tasks.map((task) => task.task_id));
  const eligible = tasks.filter((task) => !excluded.has(task.id));
  const variants: BenchmarkVariant[] = [];
  const ordered = (items: Task[], salt: string): Task[] => [...items].sort((a, b) => {
    const left = sha256(`${seed}:${salt}:${a.id}`), right = sha256(`${seed}:${salt}:${b.id}`);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const class_name of INJECTOR_CLASSES) {
    const candidates = ordered(eligible.filter((task) => !IMPROVEMENT_TASKS[task.id] && byTask.get(task.id)!.every((row) => {
      const output = row.output!, check = expectedCheck(task, class_name);
      if (!canInject(task, output, class_name) || (check && status(check, normalise(output, task)) !== 'pass')) return false;
      return !check || status(check, normalise(inject(class_name, task, output), task)) === 'fail';
    })), class_name);
    if (!candidates.length) continue;
    for (let index = 0; index < 12; index++) {
      const task = candidates[index % candidates.length], id = `plant.${class_name}.${String(index + 1).padStart(3, '0')}`;
      const before = byTask.get(task.id)!.map((row) => recorded(task, row.sample, cloneJson(row.output!)));
      const after = before.map((row) => recorded(task, row.sample, inject(class_name, task, row.output!, nonceFor(seed, id, row.sample))));
      const check = expectedCheck(task, class_name);
      variants.push(variant(suite, task, { id, kind: 'planted', class_name,
        expected_miss_reason: check ? null : 'Lost fact has no declared deterministic fact check; semantic slot review does not create REGRESSED' }, before, after, check));
    }
  }
  for (const [controlIndex, class_name] of CONTROL_KINDS.entries()) {
    const candidates = ordered(eligible.filter((task) => byTask.get(task.id)!.every((row) => {
      const output = row.output!;
      if (!canControl(class_name, task, output)) return false;
      const after = normalise(benignControl(class_name, task, output), task), before = normalise(output, task);
      return task.checks.every((check) => status(check, before) === status(check, after) && status(check, before) !== 'error');
    })), class_name);
    if (!candidates.length) continue;
    for (let index = 0; index < (controlIndex === 0 ? 18 : 17); index++) {
      const task = candidates[index % candidates.length], id = `control.${class_name}.${String(index + 1).padStart(3, '0')}`;
      const before = byTask.get(task.id)!.map((row) => recorded(task, row.sample, cloneJson(row.output!)));
      const after = before.map((row) => recorded(task, row.sample, benignControl(class_name, task, row.output!, nonceFor(seed, id, row.sample))));
      variants.push(variant(suite, task, { id, kind: 'control', class_name, expected_miss_reason: null }, before, after, null));
    }
  }
  const improvementTasks = ordered(eligible.filter((task) => IMPROVEMENT_TASKS[task.id]), 'improvements');
  for (let index = 0; improvementTasks.length && index < 30; index++) {
    const task = improvementTasks[index % improvementTasks.length], class_name = IMPROVEMENT_TASKS[task.id];
    const id = `improvement.${class_name}.${String(index + 1).padStart(3, '0')}`;
    const pairs = byTask.get(task.id)!.map((row) => ({ sample: row.sample, ...improvementPair(task, row.output!, nonceFor(seed, id, row.sample)) }));
    const before = pairs.map((pair) => recorded(task, pair.sample, pair.old)), after = pairs.map((pair) => recorded(task, pair.sample, pair.new));
    variants.push(variant(suite, task, { id, kind: 'improvement', class_name, expected_miss_reason: null }, before, after, expectedCheck(task, class_name)));
  }
  const variantMetadata = variants.map(metadata);
  const content: Omit<BenchmarkManifest, 'manifest_sha256'> = {
    version: BENCHMARK_VERSION, seed, freeze_date,
    source: { description: 'Author-built synthetic variants derived exclusively from the project old-side fixture recordings', licence: 'MIT',
      recordings: 'fixtures/recordings/old.jsonl', independent_demo_new: true },
    split: { algorithm: SPLIT_ALGORITHM, unit: 'base task id', heldout_fraction: 0.5 },
    token_recount: { algorithm: TOKEN_RECOUNT_ALGORITHM, synthetic: true,
      limitation: 'Lexical fixture tokenizer recounts generated text; not a provider tokenizer, billing measurement, or live spend' },
    suite_sha256: hash(suite), old_recordings_sha256: hash(rows), variants_sha256: hash(variantMetadata),
    counts: { planted: variants.filter((row) => row.kind === 'planted').length, control: variants.filter((row) => row.kind === 'control').length,
      improvement: variants.filter((row) => row.kind === 'improvement').length },
    class_support: supportInventory(variants), excluded_tasks, variants: variantMetadata,
    limitations: ['Author-built plants measure wiring and false alarms, not real-world model drift.',
      'Variants share base tasks; Wilson intervals are descriptive and variants are not independent observations.',
      'Single-task classes can have no held-out support; absent support means not evaluated.',
      'Lost fact without a declared fact check is an expected deterministic miss; tone shifts and subtly wrong numbers are not claimed covered.',
      'Improvement fixtures reverse injectors only on reserved tasks, and support is reported by class.',
      'Recorded-error tasks are excluded from generated variants and separately accounted as COULD_NOT_JUDGE; no executed metric is stored here.'],
  };
  return { manifest: { ...content, manifest_sha256: hash(content) }, variants };
}
