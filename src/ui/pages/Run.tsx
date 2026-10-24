import { useState } from 'react';
import { SuiteSchema, suiteWarnings, type Suite } from '../../core/regressdiff/schema/suite.ts';
import { compare, type Comparison } from '../../core/regressdiff/compare.ts';
import type { RulingEvent } from '../../core/regressdiff/rulings.ts';
import type { RunArgs } from '../../core/regressdiff/schema/manifest.ts';
import type { MemoryStore } from '../../lib/store/memory.ts';
import { demoSuite, demoModels, demoProvider, runDemo, type DemoProgress } from '../../lib/demo.ts';

export function Run({ store }: { store: MemoryStore }) {
  const [suite, setSuite] = useState<Suite>(demoSuite), [paste, setPaste] = useState('');
  const [k, setK] = useState<1 | 3 | 5>(3), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DemoProgress>({ completed: 0, total: 0 });
  const [comparison, setComparison] = useState<Comparison | null>(null), [showUnchanged, setShowUnchanged] = useState(false);
  const [reason, setReason] = useState('');
  function validate(text: string) {
    try { setSuite(SuiteSchema.parse(JSON.parse(text))); setError(''); setComparison(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid suite JSON'); }
  }
  async function start() {
    setBusy(true); setError(''); setComparison(null);
    try {
      const result = await runDemo(suite, { k, old_model: 'mock:old', new_model: 'mock:new' }, store, setProgress,
        () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      setComparison(result.comparison);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Run could not start'); }
    finally { setBusy(false); }
  }
  function rule(finding_id: string, kind: RulingEvent['kind']) {
    if (!comparison) return;
    try {
      const event: RulingEvent = { id: `ruling-${String(store.listRulings().length + 1).padStart(6, '0')}`, owner_id: store.owner_id,
        run_id: comparison.manifest.run_id, finding_id, kind, reason: reason.trim(), created_at: new Date().toISOString(), supersedes: null };
      store.addRuling(event);
      const args: RunArgs = { k: comparison.manifest.k, old_model: 'mock:old', new_model: 'mock:new' };
      setComparison(compare({ suite: comparison.suite, args, run_id: comparison.manifest.run_id, manifest: comparison.manifest,
        owner_id: store.owner_id, samples: store.listSamples(comparison.manifest.run_id), rulings: store.listRulings() }));
      setReason(''); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Ruling could not be saved'); }
  }
  const estimate = demoProvider.estimate(comparison?.manifest.old_model ?? demoModels.models[0]);
  return <>
    <section className="panel">
      <h2>Choose the suite</h2>
      <button disabled={busy} onClick={() => { setSuite(demoSuite); setError(''); setComparison(null); }}>Use the demo suite</button>
      <p>{suite.name} · {suite.tasks.length} tasks · mock:old → mock:new</p>
      <label>Samples per side <select disabled={busy} value={k} onChange={(event) => setK(Number(event.target.value) as 1 | 3 | 5)}>
        <option value={1}>1</option><option value={3}>3</option><option value={5}>5</option>
      </select></label>
      <details><summary>Paste or upload suite JSON</summary>
        <p>Only exact demo task configurations have recordings. Other tasks become recorded errors; choose a new suite id when changing a saved suite.</p>
        <label>Suite JSON<textarea disabled={busy} value={paste} onChange={(event) => setPaste(event.target.value)} rows={7} /></label>
        <button disabled={busy} onClick={() => validate(paste)}>Validate and use JSON</button>
        <label>Upload JSON<input disabled={busy} type="file" accept=".json,application/json" onChange={async (event) => {
          try { const file = event.target.files?.[0]; if (file) { const text = await file.text(); setPaste(text); validate(text); } }
          catch (failure) { setError(failure instanceof Error ? failure.message : 'File could not be read'); }
        }} /></label>
      </details>
      {suiteWarnings(suite).map((warning) => <p key={`${warning.task_id}/${warning.check_id}`} className="warning">{warning.task_id}/{warning.check_id}: {warning.message}</p>)}
      <p>{estimate.status === 'known' ? 'Estimated spend: USD 0.00 (mock)' : estimate.reason}. Synthetic check costs are separate from spend.</p>
      <p>live estimate unavailable: no verified model prices</p>
      <button disabled={busy} onClick={start}>{busy ? 'Replaying…' : 'Run comparison'}</button>
      {progress.total > 0 && <p aria-live="polite"><progress value={progress.completed} max={progress.total} /> {progress.completed}/{progress.total} recorded samples</p>}
    </section>
    {error && <pre role="alert" className="error">{error}</pre>}
    {comparison && <section className="panel">
      <h2>Comparison cells</h2>
      <p>{comparison.cells.length} cells computed from stored samples. Suite policy, pointer resolution and report export are not available in this preview.</p>
      {comparison.orphaned_rulings.length > 0 && <p>{comparison.orphaned_rulings.length} rulings from an earlier engine version not replayed (or changed output/check configuration).</p>}
      <label>Reason for the next ruling<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <p>Rulings preserve evidence and the original verdict. Waivers of always-blocking checks do not lift the default policy.</p>
      {comparison.findings.map((finding) => <article key={finding.id} className={`finding ${finding.verdict.toLowerCase()}`}>
        <h3>{finding.task_id} / {finding.check_id}</h3>
        <p><strong>{finding.original_severity}</strong> · {finding.check_type} {finding.current_ruling ? `· ${finding.current_ruling.kind}` : ''}</p>
        <p>Old: {finding.cell.old_counts.pass}/{comparison.manifest.k} pass; new: {finding.cell.new_counts.pass}/{comparison.manifest.k} pass; errors: {finding.cell.error_counts.old + finding.cell.error_counts.new}</p>
        {finding.cell.provisional && <p>Information-only provisional: {finding.cell.provisional.verdict ?? 'no complete judged pairs'} ({finding.cell.provisional.paired_judged} pairs).</p>}
        {finding.current_ruling && <p>Ruling reason: {finding.current_ruling.reason}</p>}
        <button disabled={!reason.trim()} onClick={() => rule(finding.id, 'confirmed')}>Confirm</button>{' '}
        <button disabled={!reason.trim()} onClick={() => rule(finding.id, 'waived')}>Waive</button>{' '}
        <button disabled={!reason.trim()} onClick={() => rule(finding.id, 'retest')}>Retest</button>
      </article>)}
      <label><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} /> Show unchanged cells</label>
      {showUnchanged && <ul>{comparison.cells.filter((cell) => cell.verdict === 'UNCHANGED').map((cell) => <li key={`${cell.task_id}/${cell.check_id}`}>{cell.task_id} / {cell.check_id}: UNCHANGED{cell.instability_note ? ` (${cell.instability_note})` : ''}</li>)}</ul>}
    </section>}
  </>;
}
