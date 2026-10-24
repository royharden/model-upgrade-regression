import type { Comparison } from '../core/regressdiff/compare.ts';
import { evaluatePolicy } from '../core/regressdiff/policy.ts';

export type ReviewItem = { kind: 'deterministic'; value: Comparison['findings'][number] } |
  { kind: 'semantic'; value: Comparison['semantic_reviews'][number] };
const text = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const tieKey = (item: ReviewItem): string => item.kind === 'deterministic' ? item.value.check_id : item.value.baseline;

/** Display priority only: verdicts, ruling replay and policy remain in the shared core. */
export function reviewItems(comparison: Comparison): ReviewItem[] {
  // Use the same unwaived shared-policy priority as compare; badges still show effective policy.
  const orderingBlocks = new Set(evaluatePolicy({ policy: comparison.decision.raw_policy, manifest: comparison.manifest,
    cells: comparison.cells, findings: comparison.findings.map((finding) => ({ ...finding, current_ruling: null })) }).block_causing_ids);
  const rank = (item: ReviewItem): number => {
    if (item.kind === 'semantic') return item.value.support === 'unsupported' ? 2 : 4;
    const finding = item.value;
    if (orderingBlocks.has(finding.id)) return 0;
    if (finding.verdict === 'REGRESSED') return 1;
    if (finding.support === 'unsupported') return 2;
    if (finding.verdict === 'COULD_NOT_JUDGE') return 3;
    if (finding.current_ruling?.kind === 'retest') return 4;
    return { WITHIN_NOISE: 5, PRE_EXISTING: 6, IMPROVED: 7, UNCHANGED: 8 }[finding.verdict];
  };
  const items: ReviewItem[] = [...comparison.findings.map((value): ReviewItem => ({ kind: 'deterministic', value })),
    ...comparison.semantic_reviews.map((value): ReviewItem => ({ kind: 'semantic', value }))];
  return items.sort((left, right) => {
    const priority = rank(left), difference = priority - rank(right);
    // Only deterministic items occupy these two buckets; core owns their blocking/family order.
    if (difference || priority < 2) return difference;
    return text(left.value.task_id, right.value.task_id) || text(tieKey(left), tieKey(right)) || text(left.value.id, right.value.id);
  });
}

/** Resolve against stored task samples and reuse the core's one semantic diff projection. */
export function semanticEvidence(comparison: Comparison, review: Comparison['semantic_reviews'][number]) {
  // Every task has at least one check; taking one cell avoids duplicate stored sample identities.
  const cell = comparison.cells.find((item) => item.task_id === review.task_id);
  const samples = cell ? [...cell.old_results, ...cell.new_results].map(({ sample }) => sample) : [];
  return { samples, sample: review.diff_sample, diffs: review.diffs };
}
