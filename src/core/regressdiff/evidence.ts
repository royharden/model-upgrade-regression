import { canonical } from './canonical.ts';
import type { NormalisedOutput } from './schema/output.ts';

export const EVIDENCE_FIELDS = ['text', 'thinking', 'tool_calls', 'tool_calls_original', 'stop_reason', 'usage', 'latency_ms'] as const;
export type EvidenceField = typeof EVIDENCE_FIELDS[number];
export const MISSING_VIEW = '[unavailable]';
export type Evidence =
  | { field: EvidenceField; start: number; end: number; quote: string }
  | { field: EvidenceField; anchor: number; context: string };
export type CheckStatus = 'pass' | 'fail' | 'error';
export interface CheckResult { status: CheckStatus; evidence: Evidence; expected: unknown; observed: unknown; detail: string }

export function fieldView(output: NormalisedOutput, field: EvidenceField): string {
  const value = output[field];
  if (value === null) return MISSING_VIEW;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return canonical(value);
}
export function spanEvidence(output: NormalisedOutput, field: EvidenceField, start = 0, end?: number): Evidence {
  const points = Array.from(fieldView(output, field));
  const last = end ?? points.length;
  if (!Number.isInteger(start) || !Number.isInteger(last) || start < 0 || last < start || last > points.length) {
    throw new Error('Evidence bounds outside canonical field view');
  }
  return { field, start, end: last, quote: points.slice(start, last).join('') };
}
export function anchorEvidence(output: NormalisedOutput, field: EvidenceField, anchor = 0): Evidence {
  const points = Array.from(fieldView(output, field));
  if (!Number.isInteger(anchor) || anchor < 0 || anchor > points.length) throw new Error('Invalid evidence anchor');
  return { field, anchor, context: points.slice(Math.max(0, anchor - 20), anchor + 20).join('') };
}
/** Convert a JS regex/indexOf UTF-16 index to the evidence code-point coordinate system. */
export const codePointIndex = (text: string, utf16Index: number): number => Array.from(text.slice(0, utf16Index)).length;
export function matchEvidence(output: NormalisedOutput, field: EvidenceField, index: number, quote: string): Evidence {
  const start = codePointIndex(fieldView(output, field), index);
  return spanEvidence(output, field, start, start + Array.from(quote).length);
}
