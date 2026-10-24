import { useState } from 'react';
import type { Comparison } from '../../core/regressdiff/compare.ts';
import { VerdictBadge } from '../components/VerdictBadge.tsx';

export function Findings({ comparison, onOpen, onReport }: {
  comparison: Comparison; onOpen: (id: string) => void; onReport: () => void;
}) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const decision = comparison.decision;
  return <section className="panel" aria-labelledby="findings-title">
    <div className="section-heading"><h2 id="findings-title">Review findings</h2><button onClick={onReport}>View report & export</button></div>
    <p><VerdictBadge verdict={decision.verdict} /> {decision.rules.join(' · ')}</p>
    <p>{comparison.findings.length} findings · {comparison.cells.length} cells · {decision.effective_regressed_count} effective regressions ({decision.regressed_count} original).</p>
    <p className="muted">Worst first: block-causing, regressed, unsupported, could-not-judge, review/retest, within noise, pre-existing, improved. Waived findings keep their position.</p>
    {comparison.orphaned_rulings.length > 0 && <p className="warning">{comparison.orphaned_rulings.length} rulings from an earlier engine version not replayed (or changed output/check configuration). Events remain in the report audit.</p>}
    {comparison.findings.length === 0 && <p>No changed or uncertain cells. Review diagnostics and the policy before migrating.</p>}
    <ol className="findings-list">{comparison.findings.map((finding) => <li key={finding.id} className={`finding ${finding.verdict.toLowerCase()}`}>
      <div className="section-heading"><h3><button className="text-button" onClick={() => onOpen(finding.id)}>{finding.task_id} / {finding.check_id}</button></h3>
        {finding.block_causing && <VerdictBadge verdict="BLOCK" label="Causes BLOCK" />}</div>
      <p><VerdictBadge verdict={finding.original_severity} /> <span>{finding.check_type}</span> · <span className={`support-${finding.support}`}>{finding.support === 'supported' ? '✓ Supported evidence' : 'Unsupported evidence'}</span>
        {finding.current_ruling && <> · <VerdictBadge verdict={finding.current_ruling.kind} label={finding.current_ruling.kind} /></>}</p>
      <p>Original severity: {finding.original_severity}. Effective status: {finding.current_ruling?.kind ?? 'unruled'}{finding.block_causing ? ' · blocks migration' : ''}.</p>
      <p>Old {finding.cell.old_counts.pass}/{comparison.manifest.k} pass → new {finding.cell.new_counts.pass}/{comparison.manifest.k} pass; errors old {finding.cell.error_counts.old}, new {finding.cell.error_counts.new}.</p>
      {finding.current_ruling && <p>Review reason: {finding.current_ruling.reason}</p>}
      <button onClick={() => onOpen(finding.id)}>Inspect diff & evidence</button>
    </li>)}</ol>
    <label><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} /> Show unchanged cells</label>
    {showUnchanged && <ul>{comparison.cells.filter((cell) => cell.verdict === 'UNCHANGED' && !comparison.findings.some((finding) => finding.task_id === cell.task_id && finding.check_id === cell.check_id)).map((cell) => <li key={`${cell.task_id}/${cell.check_id}`}>
      {cell.task_id} / {cell.check_id}: UNCHANGED{cell.instability_note ? ` (${cell.instability_note})` : ''}
    </li>)}</ul>}
  </section>;
}
