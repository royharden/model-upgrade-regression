import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import suiteJson from '../../../../fixtures/suite.demo.json';
import { SuiteSchema } from '../../../../src/core/regressdiff/schema/suite.ts';
import { parseRecordings } from '../../../../src/lib/recordings.ts';
import { buildBenchmark } from '../../../../src/core/regressdiff/benchmark/manifest.ts';
import { runMethod } from '../../../../src/core/regressdiff/benchmark/methods.ts';
import { resolvePointer } from '../../../../src/core/regressdiff/resolver.ts';

describe('all paired-checker dev benchmark findings carry supported old/new evidence', () => {
  it('resolves every finding at both k values and rejects deliberate corruption', () => {
    const suite = SuiteSchema.parse(suiteJson);
    const old = parseRecordings(readFileSync(new URL('../../../../fixtures/recordings/old.jsonl', import.meta.url), 'utf8'));
    const benchmark = buildBenchmark(suite, old);
    let findingCount = 0;
    for (const variant of benchmark.variants.filter((row) => row.partition === 'dev')) for (const k of [1, 5] as const) {
      const result = runMethod(variant, 'paired_checker', k);
      expect(result.pointer_integrity.supported).toBe(result.pointer_integrity.total);
      for (const finding of result.findings) {
        findingCount++;
        expect(finding.pointers.old).toHaveLength(k); expect(finding.pointers.new).toHaveLength(k);
        const samples = [...finding.cell.old_results, ...finding.cell.new_results].map((row) => row.sample);
        for (const pointer of [...finding.pointers.old, ...finding.pointers.new]) expect(resolvePointer(pointer, samples).status).toBe('supported');
        expect(resolvePointer({ ...finding.pointers.new[0], view_sha256: '0'.repeat(64) }, samples).status).toBe('unsupported');
      }
    }
    // Prevent an empty benchmark from making the universal pointer assertion vacuous.
    expect(findingCount).toBeGreaterThan(0);
  });
});
