import { canonical } from './canonical.ts';
import { sha256 } from './hash.ts';
import { NORMALISATION_VERSION } from './normalise.ts';
import { VERDICT_RULE_VERSION, type VerdictResult } from './verdict.ts';
import type { CheckConfig, CheckType } from './checks/index.ts';
import type { CheckResult } from './evidence.ts';
import type { Sample } from './pairing.ts';
import type { RulingEvent } from './rulings.ts';
import { createPointer, sampleFieldView, type EvidencePointer } from './pointers.ts';
import { resolvePointer } from './resolver.ts';
import { diffField, type FieldDiff } from './diff.ts';

export interface SampleCheck { sample: Sample; result: CheckResult }
export interface Cell extends VerdictResult {
  task_id: string; check_id: string; check_type: CheckType; check: CheckConfig; old_results: SampleCheck[]; new_results: SampleCheck[];
}
export interface Finding {
  id: string; task_id: string; check_id: string; check_type: CheckType; verdict: Cell['verdict'];
  cell: Cell; current_ruling: RulingEvent | null; original_severity: Cell['verdict'];
  /** Resolver pointers/diffs are attached in M3, from these exact sample/result pairs. */
  evidence: { old: SampleCheck[]; new: SampleCheck[] };
}
export interface EvidenceFinding extends Finding {
  pointers: { old: EvidencePointer[]; new: EvidencePointer[] }; diffs: FieldDiff[];
  support: 'supported' | 'unsupported'; support_reasons: string[]; block_causing: boolean;
}
export function attachEvidence(finding: Finding): EvidenceFinding {
  const pointers = { old: finding.evidence.old.map(({ sample, result }) => createPointer(sample, result.evidence)),
    new: finding.evidence.new.map(({ sample, result }) => createPointer(sample, result.evidence)) };
  const samples = [...finding.evidence.old, ...finding.evidence.new].map(({ sample }) => sample);
  const support_reasons = [...pointers.old, ...pointers.new].flatMap((pointer) => {
    const resolution = resolvePointer(pointer, samples);
    return resolution.status === 'unsupported' ? [`${pointer.pointer}: ${resolution.reason}`] : [];
  });
  // Select a failing new sample when available; use its paired old sample for an honest diff.
  const index = Math.max(0, finding.evidence.new.findIndex(({ result }) => result.status === 'fail'));
  const old = finding.evidence.old[index], next = finding.evidence.new[index];
  const fields = [...new Set([old.result.evidence.field, next.result.evidence.field])];
  return { ...finding, pointers, diffs: fields.map((field) => diffField(field, sampleFieldView(old.sample, field), sampleFieldView(next.sample, field))),
    support: support_reasons.length ? 'unsupported' : 'supported', support_reasons, block_causing: false };
}
export function findingId(cell: Cell, versions = { normalisation: NORMALISATION_VERSION, verdict: VERDICT_RULE_VERSION }): string {
  return sha256(canonical({ task_id: cell.task_id, check_id: cell.check_id, check_config_sha256: sha256(canonical(cell.check)),
    old_output_hashes: cell.old_results.map(({ sample }) => sample.output_sha256), new_output_hashes: cell.new_results.map(({ sample }) => sample.output_sha256),
    normalisation_version: versions.normalisation, verdict_rule_version: versions.verdict }));
}
export function findingsFromCells(cells: readonly Cell[], includeUnchanged = false): Finding[] {
  return cells.filter((cell) => includeUnchanged || cell.verdict !== 'UNCHANGED').map((cell) => ({
    id: findingId(cell), task_id: cell.task_id, check_id: cell.check_id, check_type: cell.check_type, verdict: cell.verdict,
    cell, current_ruling: null, original_severity: cell.verdict, evidence: { old: cell.old_results, new: cell.new_results },
  }));
}
