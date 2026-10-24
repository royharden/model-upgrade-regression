import { canonical } from '../canonical.ts';
import type { Cell, EvidenceFinding } from '../findings.ts';
import type { RunManifest } from '../schema/manifest.ts';
import type { PolicyDecision } from '../policy.ts';
import type { RulingEvent } from '../rulings.ts';
import type { SuiteStatistics } from '../stats/index.ts';

export const REPORT_SECTIONS = ['verdict + named rule', 'deltas (stats lines)', 'regressed', 're-test / could-not-judge / unsupported / needs-review',
  'pre-existing', 'within noise', 'improved', 'waived', 'raw and effective policy', 'full ruling audit'] as const;
export interface MigrationReport {
  schema_version: 'migration-report-v1'; sections: readonly string[]; manifest: RunManifest; stats: SuiteStatistics; decision: PolicyDecision;
  findings: EvidenceFinding[]; cells: Cell[]; ruling_audit: RulingEvent[]; orphaned_rulings: RulingEvent[]; cost_basis: string;
}
export function createReport(input: Omit<MigrationReport, 'schema_version' | 'sections' | 'cost_basis'>): MigrationReport {
  return { schema_version: 'migration-report-v1', sections: [...REPORT_SECTIONS], ...input,
    cost_basis: input.manifest.mode === 'demo' ? 'synthetic check price, not spend' : 'verified run-manifest check prices; unavailable stays unknown' };
}
export const renderJson = (report: MigrationReport): string => `${canonical(report)}\n`;
