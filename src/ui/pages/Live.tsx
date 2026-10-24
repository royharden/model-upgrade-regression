import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { configured, makeClient } from '../../lib/supabase.ts';
import { SupabaseStore, LiveError, type Budget } from '../../lib/store/supabase.ts';
import { LiveDriver, type LiveProgress } from '../../lib/live-driver.ts';
import { liveEstimate, verifiedModel } from '../../lib/live-estimate.ts';
import { demoModels, demoSuite } from '../../lib/demo.ts';
import { SuiteSchema, type Suite } from '../../core/regressdiff/schema/suite.ts';
import { compare, type Comparison } from '../../core/regressdiff/compare.ts';
import type { StoredRun } from '../../lib/store/types.ts';
import { Auth } from './Auth.tsx';
import { Recovery } from './Recovery.tsx';
import { Findings } from './Findings.tsx';
import { Finding } from './Finding.tsx';
import { Report } from './Report.tsx';
import { CostBar } from '../components/CostBar.tsx';
import { EstimatePanel } from '../components/EstimatePanel.tsx';
import { RunProgress } from '../components/RunProgress.tsx';
import type { ReviewRulingKind } from '../components/RulingButtons.tsx';

const modelOptions = demoModels.models.filter((model) => model.provider !== 'mock');
function errorText(failure: unknown): string {
  const code = failure instanceof LiveError ? failure.code : 'live_request_failed';
  const help: Record<string, string> = {
    no_live_access: 'An owner must grant your account live access.', cap_unset: 'Set your own spend cap first.',
    user_cap_exceeded: 'Your cap cannot cover the next reservation.', global_cap_exceeded: 'The deployment cannot accept more spend. Contact its owner.',
    deployment_blocked: 'The deployment is blocked. Contact its owner.', user_blocked: 'Your account is blocked pending owner ledger review.',
    billing_unknown: 'Verified model billing is unavailable.', model_not_allowed: 'This model is not allowed.',
    config_changed: 'Paused: model configuration changed. Create a new run after reviewing the new configuration.',
    missing_secret: 'The deployment owner must configure the required server secret names in BOLT-HANDOFF.md.',
    transport_outcome_unknown: 'Request outcome is unknown. Refresh stored evidence and ledger before deciding whether to retry.',
    in_flight: 'An existing attempt is still in flight. Refresh after it completes; ask the owner to investigate a stranded attempt.',
  };
  return `${code}: ${help[code] ?? 'The operation was not completed. Review setup, ownership and server configuration.'}`;
}
export default function Live() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null), [authReady, setAuthReady] = useState(false), [authError, setAuthError] = useState('');
  const [recovery, setRecovery] = useState(() => new URLSearchParams(window.location.search).has('recovery'));
  useEffect(() => {
    const liveClient = makeClient(import.meta.env);
    if (!liveClient) return;
    setClient(liveClient);
    let mounted = true, authEventSeen = false;
    liveClient.auth.startAutoRefresh();
    const { data } = liveClient.auth.onAuthStateChange((event, current) => {
      if (!mounted) return;
      authEventSeen = true;
      setSession(current); setAuthReady(true);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    void liveClient.auth.getSession().then(({ data: result, error }) => {
      if (mounted) { if (!authEventSeen) setSession(result.session); setAuthReady(true); if (error) setAuthError('Session could not be restored. Sign in again.'); }
    }).catch(() => { if (mounted) { setAuthReady(true); setAuthError('Authentication service could not be reached.'); } });
    return () => { mounted = false; data.subscription.unsubscribe(); liveClient.auth.stopAutoRefresh(); };
  }, []);
  if (!configured(import.meta.env)) return <section className="panel"><h2>Live setup required</h2><p>Set the public VITE_SUPABASE_URL (HTTPS project URL) and VITE_SUPABASE_ANON_KEY in the hosting environment, then reload. Never put provider or service-role secrets in frontend configuration.</p><p>Backend provisioning, auth settings, model verification and owner access grants remain pending. Demo works without these values.</p></section>;
  if (!client) return <p>Preparing live connection…</p>;
  return <>{authError && <p role="alert">{authError}</p>}{recovery ? <Recovery client={client} ready={authReady && !!session} onDone={() => {
    setRecovery(false); window.history.replaceState(null, '', window.location.pathname);
  }} /> : !authReady ? <p>Restoring session…</p> : session ? <LiveRun key={session.user.id} client={client} owner={session.user.id} /> : <Auth client={client} />}</>;
}
function LiveRun({ client, owner }: { client: SupabaseClient; owner: string }) {
  const store = useMemo(() => new SupabaseStore(client, owner), [client, owner]);
  const [driver] = useState(() => new LiveDriver());
  const mounted = useRef(false);
  const dispatchEpoch = useRef(0);
  const [suite, setSuite] = useState<Suite>(demoSuite), [paste, setPaste] = useState('');
  const [oldId, setOldId] = useState(''), [newId, setNewId] = useState(''), [k, setK] = useState<1 | 3 | 5>(3);
  const [budget, setBudget] = useState<Budget | null>(null), [unknownUsd, setUnknownUsd] = useState(0), [cap, setCap] = useState('');
  const [acknowledged, setAcknowledged] = useState(false), [retryAcknowledged, setRetryAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [run, setRun] = useState<StoredRun | null>(null), [resumeId, setResumeId] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null), [page, setPage] = useState<'findings' | 'finding' | 'report'>('findings'), [findingId, setFindingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<LiveProgress>({ completed: 0, total: 0, state: 'paused', reason: null });
  const models = [modelOptions.find((model) => model.id === oldId), modelOptions.find((model) => model.id === newId)];
  const estimate = models[0] && models[1] ? liveEstimate(suite, [models[0], models[1]], k) : null;
  useEffect(() => {
    mounted.current = true;
    const pause = () => { dispatchEpoch.current++; driver.pause(); };
    const hidden = () => { if (document.visibilityState === 'hidden') pause(); };
    window.addEventListener('pagehide', pause); document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; pause(); window.removeEventListener('pagehide', pause); document.removeEventListener('visibilitychange', hidden); };
  }, [driver]);
  async function refresh(current: StoredRun | null = run) {
    if (!mounted.current) return;
    const [nextBudget, attempts] = await Promise.all([store.budget(), store.attempts()]);
    if (!mounted.current) return;
    setBudget(nextBudget); setUnknownUsd(attempts.filter((attempt) => attempt.status === 'unknown_liability').reduce((sum, attempt) => sum + attempt.reserve_usd, 0));
    if (current) {
      const [samples, rulings] = await Promise.all([store.listSamples(current.id), store.listRulings()]);
      setComparison(compare({ suite: current.suite, args: current.args, samples, run_id: current.id, owner_id: owner, manifest: current.manifest, rulings }));
    }
  }
  useEffect(() => { void refresh(null).catch((failure: unknown) => setError(errorText(failure))); }, [store]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }
  async function dispatch(current: StoredRun, retryFailed = false) {
    // A create_run response can arrive after leaving Live. It must never start a new browser queue.
    if (!mounted.current || document.visibilityState === 'hidden') return;
    const result = await driver.run(current, store, setProgress, { retryFailed });
    setRetryAcknowledged(false); await refresh(current);
    if (!mounted.current) return;
    const saved = await store.listSamples(current.id);
    setProgress({ ...result, completed: saved.length });
  }
  async function rule(kind: ReviewRulingKind, reason: string): Promise<boolean> {
    if (!run || !findingId || !reason.trim()) return false;
    try {
      await store.addRuling({ id: crypto.randomUUID(), owner_id: owner, run_id: run.id, finding_id: findingId, kind, reason: reason.trim(), created_at: new Date().toISOString(), supersedes: null });
      await refresh(run); return true;
    } catch (failure) { setError(errorText(failure)); return false; }
  }
  const selected = comparison?.findings.find((finding) => finding.id === findingId);
  return <><section className="panel"><h2>Live comparison</h2><p>Signed in as {owner}</p>
    <button disabled={busy} onClick={() => perform(async () => { driver.pause(); const { error: signoutError } = await client.auth.signOut(); if (signoutError) throw new LiveError('signout_failed'); })}>Sign out</button>
    <p className="warning">Starting sends suite prompts, tool schemas and model outputs to the configured provider and stores evidence in your account. Tool calls are recorded as data. This browser dispatches at most two requests at once; closing or hiding it pauses new dispatch.</p>
    <label>Your USD cap<input disabled={busy} type="number" min="0" step="0.01" value={cap} onChange={(event) => setCap(event.target.value)} /></label>
    <button disabled={busy || !cap.trim()} onClick={() => perform(async () => { await store.setCap(Number(cap)); await refresh(); })}>Set my cap</button>
    <button disabled={busy} onClick={() => perform(async () => { await store.setCap(null); await refresh(); })}>Unset my cap</button>
    <CostBar live spentUsd={budget?.spent_usd ?? 0} reservedUsd={budget?.reserved_usd ?? 0} capUsd={budget?.cap_usd ?? null} unknownUsd={unknownUsd} />
    {budget?.live_blocked && <p role="alert">Your account is blocked pending owner review.</p>}
    <h3>Suite and models</h3><p>{suite.name} · {suite.tasks.length} tasks · logical suite id {suite.id}</p>
    <label>Suite JSON<textarea disabled={busy} rows={6} value={paste} onChange={(event) => setPaste(event.target.value)} /></label>
    <button disabled={busy} onClick={() => { try { setSuite(SuiteSchema.parse(JSON.parse(paste))); setError(''); } catch { setError('invalid_suite: Validate the JSON shape, task limits and check parameters. Use a new suite id for changed saved content.'); } }}>Validate and use suite JSON</button>
    <label>Upload JSON<input type="file" disabled={busy} accept=".json,application/json" onChange={async (event) => {
      try { const file = event.target.files?.[0]; if (file) { const text = await file.text(); setPaste(text); setSuite(SuiteSchema.parse(JSON.parse(text))); setError(''); } } catch { setError('invalid_suite: The uploaded file is not a valid suite.'); }
    }} /></label>
    {(['old', 'new'] as const).map((side) => <label key={side}>{side} model<select disabled={busy} value={side === 'old' ? oldId : newId} onChange={(event) => (side === 'old' ? setOldId : setNewId)(event.target.value)}>
      <option value="">Choose a verified model</option>{modelOptions.map((model) => <option key={model.id} value={model.id} disabled={!verifiedModel(model)}>{model.id}{verifiedModel(model) ? '' : ' — unverified; disabled'}</option>)}</select></label>)}
    <label>Samples per side<select disabled={busy} value={k} onChange={(event) => setK(Number(event.target.value) as 1 | 3 | 5)}><option value={1}>1</option><option value={3}>3</option><option value={5}>5</option></select></label>
    <EstimatePanel live taskCount={suite.tasks.length} k={k} estimateUsd={estimate} />
    <label><input type="checkbox" disabled={busy} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I authorize the provider transfer and paid calls within my cap.</label>
    <button disabled={busy || !acknowledged || estimate === null || budget?.cap_usd == null || budget.live_blocked} onClick={() => perform(async () => {
      const epoch = dispatchEpoch.current;
      const created = await store.createRun(suite, { k, old_model: oldId, new_model: newId });
      if (!mounted.current) return;
      setRun(created); setResumeId(created.id); setPage('findings');
      if (epoch !== dispatchEpoch.current) { setProgress({ completed: 0, total: created.suite.tasks.length * 2 * created.args.k, state: 'paused', reason: 'user_paused' }); return; }
      await dispatch(created);
    })}>Create and explicitly start live run</button>
    <h3>Resume stored run</h3><p>Stored recorded errors are terminal evidence for that sample. Retesting a recorded error requires a new run. Resume and retry below dispatch only missing sample keys.</p><label>Run UUID<input disabled={busy} value={resumeId} onChange={(event) => setResumeId(event.target.value)} /></label>
    <button disabled={busy || !resumeId.trim()} onClick={() => perform(async () => {
      const stored = await store.getRun(resumeId.trim()); if (!mounted.current) return; if (!stored) throw new LiveError('not_owner'); setRun(stored); setPage('findings'); await refresh(stored);
      if (!mounted.current) return;
      const samples = await store.listSamples(stored.id); setProgress({ completed: samples.length, total: stored.suite.tasks.length * 2 * stored.args.k, state: 'paused', reason: 'loaded_no_dispatch' });
    })}>Load evidence without dispatch</button>
    {run && <><p>Run {run.id} · {run.args.old_model} → {run.args.new_model} · k={run.args.k}. Resume uses this frozen manifest.</p>
      <button disabled={busy || !acknowledged || budget?.cap_usd == null || budget.live_blocked || progress.reason === 'config_changed'} onClick={() => perform(() => dispatch(run))}>Resume missing samples</button>
      <label><input type="checkbox" disabled={busy} checked={retryAcknowledged} onChange={(event) => setRetryAcknowledged(event.target.checked)} /> Retry missing failed attempts with fresh reservations. Existing unknown liability stays reserved and a duplicate paid response is possible.</label>
      <button disabled={busy || !acknowledged || !retryAcknowledged || budget?.cap_usd == null || budget.live_blocked || progress.reason === 'config_changed'} onClick={() => perform(() => dispatch(run, true))}>Explicitly retry failed missing samples</button></>}
    <button disabled={!busy} onClick={() => { dispatchEpoch.current++; driver.pause(); }}>Pause new dispatch</button><button disabled={busy} onClick={() => perform(() => refresh())}>Refresh evidence and budget</button>
    <RunProgress completed={progress.completed} total={progress.total} busy={busy} /><p role="status">{progress.state}{progress.reason ? `: ${progress.reason}` : ''}</p>
    {progress.reason && <p>{errorText(new LiveError(progress.reason))}</p>}<p>Partial evidence is compared by the same checks, statistics and report engine as Demo. Missing samples remain COULD_NOT_JUDGE.</p>
  </section>{error && <p role="alert">{error}</p>}
    {comparison && page === 'findings' && <Findings comparison={comparison} onOpen={(id) => { setFindingId(id); setPage('finding'); }} onReport={() => setPage('report')} />}
    {comparison && page === 'finding' && selected && <Finding finding={selected} onBack={() => setPage('findings')} onRule={rule} />}
    {comparison && page === 'report' && <Report comparison={comparison} onBack={() => setPage('findings')} />}</>;
}
