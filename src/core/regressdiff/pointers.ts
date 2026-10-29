import { EVIDENCE_FIELDS, fieldView, MISSING_VIEW, type Evidence, type EvidenceField } from './evidence.ts';
import { sha256 } from './hash.ts';
import type { Sample } from './pairing.ts';

export interface PointerAddress { run_id: string; task_id: string; side: 'old' | 'new'; sample: number; field: EvidenceField; start: number; end: number }
export interface EvidencePointer {
  pointer: string; view_sha256: string; quote?: string; context?: string;
  /** An error record has no output. Its marker is availability evidence, never a model answer. */
  sample_error?: string;
}
const id = '[A-Za-z0-9._-]{1,64}';
const grammar = new RegExp(`^run:(${id})/task:(${id})/side:(old|new)/sample:([1-9][0-9]*)(?:/field:(${EVIDENCE_FIELDS.join('|')}))?#(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$`);
export function parsePointer(pointer: string): PointerAddress {
  const match = grammar.exec(pointer);
  if (!match) throw new Error('Invalid evidence pointer grammar');
  const sample = Number(match[4]), start = Number(match[6]), end = Number(match[7]);
  if (![sample, start, end].every(Number.isSafeInteger) || end < start) throw new Error('Invalid pointer coordinates');
  return { run_id: match[1], task_id: match[2], side: match[3] as 'old' | 'new', sample, field: (match[5] ?? 'text') as EvidenceField, start, end };
}
export function formatPointer(address: PointerAddress, omitTextField = false): string {
  const { run_id, task_id, side, sample, field, start, end } = address;
  const pointer = `run:${run_id}/task:${task_id}/side:${side}/sample:${sample}${omitTextField && field === 'text' ? '' : `/field:${field}`}#${start}-${end}`;
  parsePointer(pointer);
  return pointer;
}
export function sampleFieldView(sample: Sample, field: EvidenceField): string {
  return sample.output ? fieldView(sample.output, field) : `${MISSING_VIEW} recorded error: ${sample.error ?? 'missing_sample'}`;
}
export const anchorContext = (view: string, anchor: number): string => Array.from(view).slice(Math.max(0, anchor - 20), anchor + 20).join('');
export function createPointer(sample: Sample, evidence: Evidence): EvidencePointer {
  const view = sampleFieldView(sample, evidence.field);
  // Recorded errors address the explicit availability marker, never offsets in fabricated output.
  const start = sample.output ? ('anchor' in evidence ? evidence.anchor : evidence.start) : 0;
  const end = sample.output ? ('anchor' in evidence ? evidence.anchor : evidence.end) : 0;
  const pointer = formatPointer({ ...sample, field: evidence.field, start, end });
  const points = Array.from(view);
  if (start < 0 || end > points.length) throw new Error('Evidence pointer outside field view');
  return { pointer, view_sha256: sha256(view), ...(!sample.output
    ? { sample_error: sample.error ?? 'missing_sample', context: anchorContext(view, 0) }
    : 'anchor' in evidence ? { context: evidence.context } : { quote: evidence.quote }) };
}
