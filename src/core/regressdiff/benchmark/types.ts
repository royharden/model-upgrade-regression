import type { CheckType } from '../checks/index.ts';
import type { RecordingLine } from '../schema/output.ts';
import type { Suite } from '../schema/suite.ts';

export const INJECTOR_CLASSES = ['thinking_leak', 'refusal_appears', 'tool_argument_changed', 'required_field_dropped',
  'length_bound_passed', 'token_recount_cost_jump', 'latency_jump', 'forbidden_tool_call', 'wrong_stop_reason', 'lost_fact'] as const;
export const CONTROL_KINDS = ['trailing_newline', 'json_key_reorder', 'independent_tool_reorder', 'bullet_glyph_change',
  'fact_paraphrase', 'latency_jitter_under_cap', 'already_failing_old'] as const;
export type InjectorClass = typeof INJECTOR_CLASSES[number];
export type ControlKind = typeof CONTROL_KINDS[number];
export type BenchmarkPartition = 'dev' | 'heldout';
export type VariantKind = 'planted' | 'control' | 'improvement';
export interface BenchmarkVariant {
  id: string;
  task_id: string;
  partition: BenchmarkPartition;
  kind: VariantKind;
  class_name: InjectorClass | ControlKind;
  expected_check_type: CheckType | null;
  expected_check_id: string | null;
  expected_miss_reason: string | null;
  /** Exactly the original base task: checks are never added to make a plant detectable. */
  suite: Suite;
  old: RecordingLine[];
  new: RecordingLine[];
  /** Schema-compatible views before normalisation, exclusively for the named ablation. */
  raw_old: RecordingLine[];
  raw_new: RecordingLine[];
}
export type Variant = BenchmarkVariant;
export interface VariantMetadata {
  id: string;
  base_task_id: string;
  partition: BenchmarkPartition;
  kind: VariantKind;
  class_name: InjectorClass | ControlKind;
  expected_check_type: CheckType | null;
  expected_check_id: string | null;
  expected_miss_reason: string | null;
  base_task_sha256: string;
  variant_sha256: string;
  old_sha256: string;
  new_sha256: string;
  raw_old_sha256: string;
  raw_new_sha256: string;
}
export interface ClassSupport {
  kind: VariantKind;
  class_name: InjectorClass | ControlKind;
  dev: { variants: number; task_ids: string[]; status: 'supported' | 'not evaluated' };
  heldout: { variants: number; task_ids: string[]; status: 'supported' | 'not evaluated' };
}
export interface BenchmarkManifest {
  version: string;
  seed: number;
  freeze_date: string;
  source: { description: string; licence: 'MIT'; recordings: 'fixtures/recordings/old.jsonl'; independent_demo_new: true };
  split: { algorithm: string; unit: 'base task id'; heldout_fraction: number };
  token_recount: { algorithm: string; synthetic: true; limitation: string };
  suite_sha256: string;
  old_recordings_sha256: string;
  variants_sha256: string;
  manifest_sha256: string;
  counts: Record<VariantKind, number>;
  class_support: ClassSupport[];
  excluded_tasks: { task_id: string; reason: string; expected_accounting: 'COULD_NOT_JUDGE'; error_samples: number[] }[];
  variants: VariantMetadata[];
  limitations: string[];
}
export interface BenchmarkOptions { seed?: number; freeze_date?: string }
export interface BenchmarkData { manifest: BenchmarkManifest; variants: BenchmarkVariant[] }
