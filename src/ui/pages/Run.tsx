import { useState } from 'react';
import { SuiteSchema, suiteWarnings, type Suite } from '../../core/regressdiff/schema/suite.ts';
import { compare, type Comparison } from '../../core/regressdiff/compare.ts';
import type { RulingEvent } from '../../core/regressdiff/rulings.ts';
import type { RunArgs } from '../../core/regressdiff/schema/manifest.ts';
import type { MemoryStore } from '../../lib/store/memory.ts';
import { demoSuite, runDemo, type DemoProgress } from '../../lib/demo.ts';
import { Findings } from './Findings.tsx';
import { Finding } from './Finding.tsx';
import { SemanticFinding } from './SemanticFinding.tsx';
import { Report } from './Report.tsx';
import { CostBar } from '../components/CostBar.tsx';
import { EstimatePanel } from '../components/EstimatePanel.tsx';
import { RunProgress } from '../components/RunProgress.tsx';
import type { ReviewRulingKind } from '../components/RulingButtons.tsx';

export function Run({ store }: { store: MemoryStore }) {
  const [suite, setSuite] = useState<Suite>(demoSuite), [paste, setPaste] = useState('');
  const [k, setK] = useState<1 | 3 | 5>(3), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DemoProgress>({ completed: 0, total: 0 });
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [page, setPage] = useState<'findings' | 'finding' | 'report'>('findings'), [findingId, setFindingId] = useState<string | null>(null);
  function validate(text: string) {
    try { setSuite(SuiteSchema.parse(JSON.parse(text))); setError(''); setComparison(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid suite JSON'); }
  }
  async function start() {
    setBusy(true); setError(''); setComparison(null);
    try {
      const result = await runDemo(suite, { k, old_model: 'mock:old', new_model: 'mock:new' }, store, setProgress,
        () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      setComparison(result.comparison); setPage('findings'); setFindingId(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Run could not start'); }
    finally { setBusy(false); }
  }
  function rule(finding_id: string, kind: ReviewRulingKind, reason: string): boolean {
    if (!comparison || !reason.trim()) return false;
    try {
      const event: RulingEvent = { id: `ruling-${String(store.listRulings().length + 1).padStart(6, '0')}`, owner_id: store.owner_id,
        run_id: comparison.manifest.run_id, finding_id, kind, reason: reason.trim(), created_at: new Date().toISOString(), supersedes: null };
      store.addRuling(event);
      const args: RunArgs = { k: comparison.manifest.k, old_model: 'mock:old', new_model: 'mock:new' };
      setComparison(compare({ suite: comparison.suite, args, run_id: comparison.manifest.run_id, manifest: comparison.manifest,
        owner_id: store.owner_id, samples: store.listSamples(comparison.manifest.run_id), rulings: store.listRulings() }));
      setError(''); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Ruling could not be saved'); return false; }
  }
  const selected = comparison?.findings.find((finding) => finding.id === findingId);
  const selectedSemantic = comparison?.semantic_reviews.find((review) => review.id === findingId);
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
      <EstimatePanel taskCount={suite.tasks.length} k={k} />
      <button disabled={busy} onClick={start}>{busy ? 'Replaying…' : 'Run comparison'}</button>
      <RunProgress {...progress} busy={busy} />
      <CostBar />
    </section>
    {error && <pre role="alert" className="error">{error}</pre>}
    {comparison && page === 'findings' && <Findings comparison={comparison} onOpen={(id) => { setFindingId(id); setPage('finding'); }} onReport={() => setPage('report')} />}
    {comparison && page === 'finding' && selected && <Finding finding={selected} onBack={() => setPage('findings')} onRule={(kind, reason) => rule(selected.id, kind, reason)} />}
    {comparison && page === 'finding' && selectedSemantic && <SemanticFinding comparison={comparison} review={selectedSemantic} onBack={() => setPage('findings')} onRule={(kind, reason) => rule(selectedSemantic.id, kind, reason)} />}
    {comparison && page === 'report' && <Report comparison={comparison} onBack={() => setPage('findings')} />}
  </>;
}
