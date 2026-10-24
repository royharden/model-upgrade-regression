import { diffWordsWithSpace } from 'diff';
import type { EvidenceField } from './evidence.ts';
export interface DiffPart { value: string; added?: boolean; removed?: boolean }
export interface FieldDiff { field: EvidenceField; old_view: string; new_view: string; parts: DiffPart[] }
/** Diff exactly the resolver views, never a JSON wrapper around those views. */
export function diffField(field: EvidenceField, old_view: string, new_view: string): FieldDiff {
  return { field, old_view, new_view, parts: diffWordsWithSpace(old_view, new_view).map(({ value, added, removed }) => ({
    value, ...(added ? { added: true } : {}), ...(removed ? { removed: true } : {}),
  })) };
}
