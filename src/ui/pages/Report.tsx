import { useState } from 'react';
import type { Comparison } from '../../core/regressdiff/compare.ts';
import { renderMarkdown } from '../../core/regressdiff/report/markdown.ts';
import { renderJson } from '../../core/regressdiff/report/json.ts';
import { VerdictBadge } from '../components/VerdictBadge.tsx';

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function Report({ comparison, onBack }: { comparison: Comparison; onBack: () => void }) {
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');
  const { report, decision, stats } = comparison;
  const markdown = renderMarkdown(report), json = renderJson(report);
  const filename = `migration-${comparison.manifest.run_id}`;
  const p = (value: number | null) => value === null ? 'N/A' : value.toPrecision(4);
  return <section className="panel" aria-labelledby="report-title"><button onClick={onBack}>← All findings</button>
    <h2 id="report-title">Migration report</h2><p><VerdictBadge verdict={decision.verdict} /> {decision.rules.join(' · ')}</p>
    <p>Policy exit {decision.exit_code}{decision.error_kind ? ` · ${decision.error_kind}` : ''}. This report is generated deterministically from stored samples and the ruling audit.</p>
    <div className="actions"><button onClick={() => download(markdown, `${filename}.md`, 'text/markdown;charset=utf-8')}>Export Markdown</button>
      <button onClick={() => download(json, `${filename}.json`, 'application/json;charset=utf-8')}>Export JSON</button></div>
    <h3>Suite deltas and diagnostics</h3>
    <p>Diagnostic only; statistics never change a cell verdict. Benjamini–Hochberg q = {stats.correction.q}, denominator {stats.correction.denominator} of {stats.preregistered_tests} preregistered tests. Bootstrap seed {stats.seed}.</p>
    <div className="table-scroll"><table><thead><tr><th>Test</th><th>Method</th><th>Status</th><th>n</th><th>Raw p</th><th>Adjusted p</th></tr></thead><tbody>
      {stats.tests.map((test) => <tr key={test.id}><th scope="row">{test.id}</th><td>{test.method}</td><td>{test.status}</td><td>{test.n}</td><td>{p(test.raw_p)}</td><td>{p(test.adjusted_p)}</td></tr>)}
    </tbody></table></div>
    <p className="muted">{stats.cost_label}</p>
    <details><summary>McNemar paired counts and excluded tasks</summary><pre>{JSON.stringify(stats.mcnemar, null, 2)}</pre></details>
    <details><summary>Continuous deltas, bootstrap intervals and exclusions</summary><pre>{JSON.stringify(stats.continuous, null, 2)}</pre></details>
    <h3>Raw and effective policy</h3><div className="diff-grid"><div><h4>Raw policy</h4><pre>{JSON.stringify(decision.raw_policy, null, 2)}</pre></div>
      <div><h4>Effective policy</h4><pre>{JSON.stringify(decision.effective_policy, null, 2)}</pre></div></div>
    {decision.notes.length > 0 && <ul>{decision.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    <h3>Full ruling audit</h3><p>{comparison.ruling_audit.length} events · {comparison.orphaned_rulings.length} not replayed. Waived findings remain in the report.</p>
    <ol>{comparison.ruling_audit.map((event) => <li key={event.id}><strong>{event.kind}</strong> · {event.created_at}<br /><code>{event.finding_id}</code><p>{event.reason}</p>
      {event.supersedes && <small>Supersedes {event.supersedes}</small>}</li>)}</ol>
    <h3>Report preview</h3><label>Format <select value={format} onChange={(event) => setFormat(event.target.value as 'markdown' | 'json')}><option value="markdown">Markdown</option><option value="json">JSON</option></select></label>
    <pre className="report-preview">{format === 'markdown' ? markdown : json}</pre>
  </section>;
}
