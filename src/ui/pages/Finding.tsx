import type { Comparison } from '../../core/regressdiff/compare.ts';
import { resolvePointer } from '../../core/regressdiff/resolver.ts';
import { DiffView } from '../components/DiffView.tsx';
import { RulingButtons, type ReviewRulingKind } from '../components/RulingButtons.tsx';
import { VerdictBadge } from '../components/VerdictBadge.tsx';

export function Finding({ finding, onBack, onRule }: {
  finding: Comparison['findings'][number]; onBack: () => void;
  onRule: (kind: ReviewRulingKind, reason: string) => boolean | Promise<boolean>;
}) {
  const samples = [...finding.evidence.old, ...finding.evidence.new].map(({ sample }) => sample);
  return <section className="panel" aria-labelledby="finding-title"><button onClick={onBack}>← All findings</button>
    <h2 id="finding-title">{finding.task_id} / {finding.check_id}</h2>
    <p><VerdictBadge verdict={finding.original_severity} /> · {finding.check_type} · {finding.block_causing ? 'Causes BLOCK' : 'Review item'}</p>
    <p>Original severity: {finding.original_severity}. Effective status: {finding.current_ruling?.kind ?? 'unruled'}.</p>
    {finding.current_ruling && <p>Current ruling: {finding.current_ruling.kind} · {finding.current_ruling.reason}</p>}
    <p className={`support-${finding.support}`}>{finding.support === 'supported' ? '✓ Evidence supported' : 'Evidence unsupported'}</p>
    {finding.support_reasons.length > 0 && <ul>{finding.support_reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    {finding.cell.provisional && <p className="warning">Information-only provisional verdict: {finding.cell.provisional.verdict ?? 'no complete judged pairs'} ({finding.cell.provisional.paired_judged} pairs). Recorded errors keep the original COULD_NOT_JUDGE verdict.</p>}
    <details><summary>Check configuration</summary><pre>{JSON.stringify(finding.cell.check, null, 2)}</pre></details>
    <p>Field diff from a representative paired sample, preferring a failing new sample. Every sample’s evidence pointer is listed below.</p>
    <DiffView diffs={finding.diffs} />
    <section aria-label="Evidence pointers"><h3>Evidence pointers</h3><p>Each pointer re-opens the stored sample and checks its exact view hash, code-point offsets and quote or anchor context.</p>
      {(['old', 'new'] as const).map((side) => <div key={side}><h4>{side === 'old' ? 'Old' : 'New'} evidence</h4>
        <ul className="pointer-list">{finding.pointers[side].map((pointer, index) => {
          const resolved = resolvePointer(pointer, samples);
          return <li key={`${pointer.pointer}-${index}`}><strong className={`support-${resolved.status}`}>{resolved.status === 'supported' ? '✓ supported' : 'unsupported'}</strong>
            <code>{pointer.pointer}</code><small>View SHA-256: {pointer.view_sha256}</small>
            {pointer.quote !== undefined && <pre aria-label="Evidence quote">{pointer.quote || '(empty quote)'}</pre>}
            {pointer.context !== undefined && <pre aria-label="Anchor context">{pointer.context || '(empty anchor context)'}</pre>}
            {resolved.reason && <p className="warning">{resolved.reason}</p>}</li>;
        })}</ul></div>)}
    </section>
    <details><summary>Per-sample check results</summary>{(['old', 'new'] as const).map((side) => <div key={side}><h4>{side}</h4><ul>
      {finding.evidence[side].map(({ sample, result }) => <li key={sample.sample}>Sample {sample.sample}: {result.status} · {result.detail}{sample.error ? ` · ${sample.error}` : ''}</li>)}
    </ul></div>)}</details>
    <RulingButtons key={finding.id} onRule={onRule} />
  </section>;
}
