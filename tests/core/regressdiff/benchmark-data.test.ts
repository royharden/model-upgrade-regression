import { describe, expect, it } from 'vitest';
import suiteJson from '../../../fixtures/suite.demo.json';
import oldJsonl from '../../../fixtures/recordings/old.jsonl?raw';
import { parseRecordings } from '../../../src/lib/recordings.ts';
import { canonical } from '../../../src/core/regressdiff/canonical.ts';
import { sha256 } from '../../../src/core/regressdiff/hash.ts';
import { RecordingLineSchema } from '../../../src/core/regressdiff/schema/output.ts';
import { SuiteSchema } from '../../../src/core/regressdiff/schema/suite.ts';
import { buildBenchmark, BENCHMARK_VERSION } from '../../../src/core/regressdiff/benchmark/manifest.ts';
import { partitionForTask } from '../../../src/core/regressdiff/benchmark/split.ts';
import { CONTROL_KINDS, INJECTOR_CLASSES } from '../../../src/core/regressdiff/benchmark/types.ts';

const suite = SuiteSchema.parse(suiteJson), old = parseRecordings(oldJsonl);
const data = buildBenchmark(suite, old);
const hash = (value: unknown): string => sha256(canonical(value));
describe('frozen benchmark source data', () => {
  it('builds 120 plants, 120 controls, and 30 improvements without changing the source', () => {
    const before = canonical({ suite, old });
    const rebuilt = buildBenchmark(suite, old);
    expect(canonical({ suite, old })).toBe(before);
    expect(rebuilt.manifest.counts).toEqual({ planted: 120, control: 120, improvement: 30 });
    expect(new Set(rebuilt.variants.map((item) => item.id)).size).toBe(270);
    expect(new Set(rebuilt.variants.filter((item) => item.kind === 'planted').map((item) => item.class_name))).toEqual(new Set(INJECTOR_CLASSES));
    expect(new Set(rebuilt.variants.filter((item) => item.kind === 'control').map((item) => item.class_name))).toEqual(new Set(CONTROL_KINDS));
    for (const item of rebuilt.variants) {
      expect(item.suite.tasks).toEqual([suite.tasks.find((task) => task.id === item.task_id)]);
      for (const rows of [item.old, item.new, item.raw_old, item.raw_new]) {
        expect(rows.map((row) => row.sample)).toEqual([1, 2, 3, 4, 5]);
        expect(rows.every((row) => row.task_id === item.task_id && RecordingLineSchema.safeParse(row).success)).toBe(true);
      }
    }
  });
  it('is deterministic under its seed and insensitive to input recording order', () => {
    expect(buildBenchmark(suite, old)).toEqual(data);
    expect(buildBenchmark(suite, [...old].reverse())).toEqual(data);
    const different = buildBenchmark(suite, old, { seed: 41 });
    expect(different.manifest.variants_sha256).not.toBe(data.manifest.variants_sha256);
    for (const item of different.variants) expect(item.partition).toBe(partitionForTask(item.task_id));
  });
  it('binds every variant and source to reproducible hashes, with a dated MIT synthetic provenance', () => {
    expect(data.manifest).toMatchObject({ version: BENCHMARK_VERSION, seed: 40, freeze_date: '2026-10-24',
      source: { licence: 'MIT', recordings: 'fixtures/recordings/old.jsonl', independent_demo_new: true },
      token_recount: { synthetic: true } });
    expect(data.manifest.suite_sha256).toBe(hash(suite));
    expect(data.manifest.variants_sha256).toBe(hash(data.manifest.variants));
    const { manifest_sha256, ...content } = data.manifest;
    expect(manifest_sha256).toBe(hash(content));
    for (const item of data.variants) {
      const meta = data.manifest.variants.find((row) => row.id === item.id)!;
      expect(meta.base_task_sha256).toBe(hash(item.suite.tasks[0]));
      expect(meta.variant_sha256).toBe(hash(item));
      expect(meta.old_sha256).toBe(hash(item.old));
      expect(meta.new_sha256).toBe(hash(item.new));
      expect(meta.raw_old_sha256).toBe(hash(item.raw_old));
      expect(meta.raw_new_sha256).toBe(hash(item.raw_new));
      expect(meta).toMatchObject({ expected_check_type: item.expected_check_type, expected_check_id: item.expected_check_id, class_name: item.class_name });
    }
    expect(data.manifest).not.toHaveProperty('results');
    expect(data.manifest).not.toHaveProperty('recall');
  });
  it('keeps task families in one hash-only partition and describes absent class support honestly', () => {
    for (const task of suite.tasks) {
      const expected = Number.parseInt(sha256(task.id).slice(0, 8), 16) % 2 === 0 ? 'dev' : 'heldout';
      expect(partitionForTask(task.id)).toBe(expected);
      expect(new Set(data.variants.filter((item) => item.task_id === task.id).map((item) => item.partition)).size).toBeLessThanOrEqual(1);
    }
    expect(data.manifest.class_support).toHaveLength(27);
    for (const row of data.manifest.class_support) for (const partition of ['dev', 'heldout'] as const) {
      const actual = data.variants.filter((item) => item.kind === row.kind && item.class_name === row.class_name && item.partition === partition);
      expect(row[partition]).toEqual({ variants: actual.length, task_ids: [...new Set(actual.map((item) => item.task_id))].sort(),
        status: actual.length ? 'supported' : 'not evaluated' });
    }
    const singleton = data.manifest.class_support.find((row) => row.kind === 'planted' && row.class_name === 'thinking_leak')!;
    expect([singleton.dev.status, singleton.heldout.status]).toContain('not evaluated');
  });
  it('does not plant the recorded error or disguise it as a successful excluded observation', () => {
    expect(data.variants.some((item) => item.task_id === 'con.error')).toBe(false);
    expect(data.manifest.excluded_tasks).toMatchObject([{ task_id: 'con.error', error_samples: [2], expected_accounting: 'COULD_NOT_JUDGE' }]);
    expect(old.find((row) => row.task_id === 'con.error' && row.sample === 2)?.output).toBeNull();
  });
  it('rejects incomplete or duplicate recordings and non-deterministic option shapes', () => {
    expect(() => buildBenchmark(suite, old.slice(1))).toThrow(/five/u);
    expect(() => buildBenchmark(suite, [...old, old[0]])).toThrow(/duplicate/u);
    expect(() => buildBenchmark(suite, old, { seed: NaN })).toThrow(/seed/u);
    expect(() => buildBenchmark(suite, old, { freeze_date: 'today' })).toThrow(/date/u);
  });
});
