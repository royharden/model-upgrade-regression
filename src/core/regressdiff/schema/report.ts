import { z } from 'zod';
import { EVIDENCE_FIELDS } from '../evidence.ts';

export const CheckStatusSchema = z.enum(['pass', 'fail', 'error']);
export const EvidenceSchema = z.union([
  z.object({ field: z.enum(EVIDENCE_FIELDS), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), quote: z.string() }).strict()
    .refine((span) => span.end >= span.start, 'Reversed span'),
  z.object({ field: z.enum(EVIDENCE_FIELDS), anchor: z.number().int().nonnegative(), context: z.string() }).strict(),
]);
export const CheckResultSchema = z.object({ status: CheckStatusSchema, evidence: EvidenceSchema,
  expected: z.unknown(), observed: z.unknown(), detail: z.string() }).strict();
export const CellVerdictSchema = z.enum(['REGRESSED', 'IMPROVED', 'UNCHANGED', 'WITHIN_NOISE', 'PRE_EXISTING', 'COULD_NOT_JUDGE']);
export const SuiteVerdictSchema = z.enum(['BLOCK', 'REVIEW', 'SAFE_WITH_NOTES']);
