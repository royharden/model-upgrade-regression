import type { Finding } from './findings.ts';
const rank = { REGRESSED: 1, COULD_NOT_JUDGE: 3, WITHIN_NOISE: 5, PRE_EXISTING: 6, IMPROVED: 7, UNCHANGED: 8 } as const;
const text = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const severity = (finding: Finding & { support?: string }) => Math.min(rank[finding.verdict], finding.support === 'unsupported' ? 2 : 8, finding.current_ruling?.kind === 'retest' ? 4 : 8);
export function sortFindings<T extends Finding>(findings: readonly T[], always_blocking: readonly string[] = ['tool_forbidden', 'tool_order'], blockCausing: ReadonlySet<string> = new Set()): T[] {
  return [...findings].sort((a, b) => Number(blockCausing.has(b.id)) - Number(blockCausing.has(a.id)) || severity(a) - severity(b) ||
    (a.verdict === 'REGRESSED' && b.verdict === 'REGRESSED'
      ? Number(always_blocking.includes(b.check_type)) - Number(always_blocking.includes(a.check_type)) || text(a.check_type, b.check_type) : 0) ||
    text(a.task_id, b.task_id) || text(a.check_id, b.check_id));
}
