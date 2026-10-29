import { hashError, hashOutput, sha256 } from './hash.ts';
import type { Sample } from './pairing.ts';
import { anchorContext, parsePointer, sampleFieldView, type EvidencePointer, type PointerAddress } from './pointers.ts';

export interface Resolution { status: 'supported' | 'unsupported'; reason?: string; address?: PointerAddress; view?: string; quote?: string }
export function resolvePointer(pointer: EvidencePointer, samples: readonly Sample[]): Resolution {
  const unsupported = (reason: string): Resolution => ({ status: 'unsupported', reason });
  let address: PointerAddress;
  try { address = parsePointer(pointer.pointer); } catch { return unsupported('invalid_pointer'); }
  const matches = samples.filter((sample) => sample.run_id === address.run_id && sample.task_id === address.task_id && sample.side === address.side && sample.sample === address.sample);
  if (matches.length !== 1) return unsupported(matches.length ? 'ambiguous_sample_identity' : 'sample_not_found');
  const sample = matches[0];
  const outputHash = sample.output ? hashOutput(sample.output) : hashError(sample.error ?? 'missing_sample');
  if (outputHash !== sample.output_sha256) return unsupported('sample_hash_mismatch');
  if (!sample.output && pointer.sample_error !== (sample.error ?? 'missing_sample')) return unsupported('recorded_error_mismatch');
  if (sample.output && pointer.sample_error !== undefined) return unsupported('unexpected_recorded_error');
  const view = sampleFieldView(sample, address.field), points = Array.from(view);
  if (sha256(view) !== pointer.view_sha256) return unsupported('view_hash_mismatch');
  if (address.end > points.length) return unsupported('out_of_bounds');
  const quote = points.slice(address.start, address.end).join('');
  if (pointer.context !== undefined) {
    if (pointer.quote !== undefined || address.start !== address.end || pointer.context !== anchorContext(view, address.start)) return unsupported('anchor_context_mismatch');
  } else if (pointer.quote === undefined || pointer.quote !== quote) return unsupported('quote_mismatch');
  return { status: 'supported', address, view, quote };
}
