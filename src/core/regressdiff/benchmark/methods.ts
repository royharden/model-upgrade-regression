import { canonical } from '../canonical.ts';
import { compare } from '../compare.ts';
import { attachEvidence, findingsFromCells, type Cell, type EvidenceFinding } from '../findings.ts';
import { normalise } from '../normalise.ts';
import { makeSample, type Sample } from '../pairing.ts';
import { resolvePointer } from '../resolver.ts';
import type { RecordingLine } from '../schema/output.ts';
import type { Variant } from './types.ts';

export const METHOD_VERSION = 'benchmark-methods-v1';
export const METHOD_IDS = ['exact_normalised_diff', 'model_matrix', 'paired_checker', 'no_normalisation', 'no_noise_floor'] as const;
export type MethodId = typeof METHOD_IDS[number];
export type BenchmarkK = 1 | 5;
export interface MethodResult {
  variant_id: string; task_id: string; class_name: string; kind: Variant['kind']; partition: Variant['partition'];
  method: MethodId; k: BenchmarkK; flagged: boolean; attributed: boolean | null;
  flagged_check_ids: string[]; could_not_judge: number;
  pointer_integrity: { supported: number; total: number; applicable: boolean };
  findings: EvidenceFinding[];
}

function sampleRows(variant: Variant, k: BenchmarkK, raw: boolean): Sample[] {
  const task = variant.suite.tasks.find((item) => item.id === variant.task_id);
  if (!task) throw new Error('Benchmark variant does not contain its base task');
  const convert = (lines: readonly RecordingLine[], side: 'old' | 'new') => lines.filter((line) => line.sample <= k).map((line) =>
    makeSample('benchmark', side, { ...line, output: line.output && !raw ? normalise(line.output, task) : line.output }));
  return [...convert(raw ? variant.raw_old : variant.old, 'old'), ...convert(raw ? variant.raw_new : variant.new, 'new')];
}

/** Declared ablation: remove only the positive floor in both directions of the both-majorities-pass branch.
 * Errors, majority flips and both-majorities-fail PRE_EXISTING precedence stay in the core. */
export function withoutNoiseFloor(cell: Cell): Cell {
  if (cell.verdict !== 'WITHIN_NOISE') return cell;
  if (cell.old_counts.pass > cell.new_counts.pass) return { ...cell, verdict: 'REGRESSED' };
  if (cell.old_counts.pass < cell.new_counts.pass) return { ...cell, verdict: 'IMPROVED' };
  return cell;
}

/** No provider calls; all methods consume the same paired recorded rows. */
export function runMethod(variant: Variant, method: MethodId, k: BenchmarkK): MethodResult {
  if (!METHOD_IDS.includes(method) || (k !== 1 && k !== 5)) throw new Error('Unknown benchmark method or k');
  const samples = sampleRows(variant, k, method === 'no_normalisation');
  const comparison = compare({ suite: variant.suite, samples, run_id: 'benchmark', owner_id: 'benchmark',
    args: { k, old_model: 'mock:old', new_model: 'mock:new' } });
  const cells = method === 'no_noise_floor' ? comparison.cells.map(withoutNoiseFloor) : comparison.cells;
  const flaggedCells = cells.filter((cell) => method === 'model_matrix' ? cell.new_counts.fail > 0 : cell.verdict === 'REGRESSED');
  const exact = method === 'exact_normalised_diff';
  // Exact diff abstains on an unavailable pair; errors are still counted below.
  const old = samples.filter((sample) => sample.side === 'old'), next = samples.filter((sample) => sample.side === 'new');
  const exactFlag = old.some((sample) => {
    const paired = next.find((item) => item.task_id === sample.task_id && item.sample === sample.sample);
    return sample.output !== null && paired?.output != null && canonical(sample.output) !== canonical(paired.output);
  });
  const flagged_check_ids = exact ? [] : flaggedCells.map((cell) => cell.check_id);
  // Matrix findings retain their true core verdict, e.g. PRE_EXISTING; the method's flag is separate.
  const findings = exact ? [] : method === 'model_matrix' ? findingsFromCells(flaggedCells, true).map(attachEvidence)
    : method === 'no_noise_floor' ? findingsFromCells(cells).map(attachEvidence) : comparison.findings;
  const resolutions = findings.flatMap((finding) => [...finding.pointers.old, ...finding.pointers.new]).map((pointer) => resolvePointer(pointer, samples));
  return { variant_id: variant.id, task_id: variant.task_id, class_name: variant.class_name, kind: variant.kind,
    partition: variant.partition, method, k, flagged: exact ? exactFlag : flaggedCells.length > 0,
    attributed: exact ? null : variant.expected_check_id !== null && flagged_check_ids.includes(variant.expected_check_id),
    flagged_check_ids, could_not_judge: cells.filter((cell) => cell.verdict === 'COULD_NOT_JUDGE').length,
    pointer_integrity: { supported: resolutions.filter((item) => item.status === 'supported').length, total: resolutions.length, applicable: !exact }, findings };
}

export function runMethods(variants: readonly Variant[]): MethodResult[] {
  return variants.flatMap((variant) => ([1, 5] as const).flatMap((k) => METHOD_IDS.map((method) => runMethod(variant, method, k))));
}
