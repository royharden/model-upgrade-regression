import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { canonical } from './canonical.ts';
import type { NormalisedOutput } from './schema/output.ts';

export function sha256(value: string): string {
  return bytesToHex(nobleSha256(utf8ToBytes(value)));
}
export const hashOutput = (output: NormalisedOutput): string => sha256(canonical(output));
export const hashError = (error: string): string => sha256(`error:${error}`);
