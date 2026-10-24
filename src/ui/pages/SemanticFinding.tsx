import type { Comparison } from '../../core/regressdiff/compare.ts';
import { RulingButtons, type ReviewRulingKind } from '../components/RulingButtons.tsx';
import { VerdictBadge } from '../components/VerdictBadge.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { semanticEvidence } from '../review-items.ts';
import { resolvePointer } from '../../core/regressdiff/resolver.ts';

export function SemanticFinding({ comparison, review, onBack, onRule }: {
  comparison: Comparison; review: Comparison['semantic_reviews'][number]; onBack: () => void;
  onRule: (kind: ReviewRulingKind, reason: string) => boolean | Promise<boolean>;
}) {
  const { samples, diffs, sample } = semanticEvidence(comparison, review);
  return <section className="panel" aria-labelledby="semantic-title"><button onClick={onBack}>← All findings</button>
    <h2 id="semantic-title">{review.task_id} / {review.baseline}</h2>
    <p><VerdictBadge verdict={review.verdict} /> · deterministic semantic baseline {review.baseline_version}</p>
    <p>{review.detail}</p><p>Effective ruling: {review.current_ruling?.kind ?? 'unruled'}.</p>
    {review.current_ruling && <p>Review reason: {review.current_ruling.reason}</p>}
    <p className={`support-${review.support}`}>{review.support === 'supported' ? '✓ Evidence supported' : 'Evidence unsupported'}</p>
    {review.support_reasons.length > 0 && <ul>{review.support_reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    <p>Baseline observations are review prompts, not deterministic pass/fail check cells. Confirm or waive with a reason to resolve a supported item; retest remains pending. Unsupported evidence still requires review after a ruling. Retest records intent only; a fresh live sample requires a new run.</p>
    <details><summary>Semantic task metadata</summary><pre>{JSON.stringify({ required_facts: review.required_facts, expected_refusal: review.expected_refusal }, null, 2)}</pre></details>
    <p>Word-level canonical field diff from stored paired sample {sample ?? '(unavailable)'}. Every sample’s evidence pointer is listed below.</p>
    <DiffView diffs={diffs} />
    {(['old', 'new'] as const).map((side) => <section key={side} aria-label={`${side} semantic evidence`}><h3>{side === 'old' ? 'Old' : 'New'} observations and pointers</h3>
      <pre>{JSON.stringify(review.observations[side], null, 2)}</pre>
      <ul className="pointer-list">{review.pointers[side].map((pointer, index) => {
        const resolved = resolvePointer(pointer, samples);
        return <li key={`${pointer.pointer}-${index}`}><strong className={`support-${resolved.status}`}>{resolved.status === 'supported' ? '✓ supported' : 'unsupported'}</strong>
        <code>{pointer.pointer}</code><small>View SHA-256: {pointer.view_sha256}</small>
        {pointer.quote !== undefined && <pre aria-label="Evidence quote">{pointer.quote || '(empty quote)'}</pre>}
        {pointer.context !== undefined && <pre aria-label="Anchor context">{pointer.context || '(empty anchor context)'}</pre>}
        {resolved.reason && <p className="warning">{resolved.reason}</p>}
      </li>; })}</ul>
    </section>)}
    <RulingButtons key={review.id} onRule={onRule} />
  </section>;
}
