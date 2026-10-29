import { corsHeaders } from './cors.ts';
import { estimateSpend } from './portable/estimate.ts';
import { actualCost, buildRequest, capabilityMismatch } from './portable/request.ts';
import type { Model, Models } from './portable/types.ts';
import type { ParsedProvider, ProviderAccounting } from './portable/parse-common.ts';
import type { Suite, Task } from '../../../src/core/regressdiff/schema/suite.ts';
import type { NormalisedOutput } from '../../../src/core/regressdiff/schema/output.ts';
import type { RunManifest } from '../../../src/core/regressdiff/schema/manifest.ts';

export type RunTaskRequest = { op: 'create_run'; suite_id: string; old_model_id: string; new_model_id: string; k: 1 | 3 | 5 } |
  { op: 'sample'; run_id: string; task_id: string; side: 'old' | 'new'; sample: number; request_id: string };
export interface RunRow { id: string; owner_id: string; suite_id: string; suite_sha256: string; mode: string; k: 1 | 3 | 5; manifest: RunManifest; [key: string]: unknown }
export interface SuiteRow { id: string; owner_id: string; body: unknown; sha256: string }
export interface SampleRow { id?: string; owner_id: string; run_id: string; task_id: string; side: 'old' | 'new'; sample: number;
  raw: unknown; normalised: NormalisedOutput | null; output_sha256: string; error: string | null; [key: string]: unknown }
export interface RunTaskResponse { attempt_id: string | null; status: string; run?: RunRow; sample?: SampleRow; error_code?: string; ledger_outcome?: 'released' | 'settled' | 'unknown_liability'; missing_secrets?: string[] }
export interface RpcResult { outcome: string; status?: string; attempt_id?: string; attempt?: { id: string; status: string }; sample?: SampleRow; run?: RunRow }
export interface OwnedReader { suite(id: string): Promise<SuiteRow | null>; run(id: string): Promise<RunRow | null> }
export interface ProviderResult { ok: boolean; raw: unknown; parsed: ParsedProvider | null; accounting: ProviderAccounting; latency_ms: number }
export interface HandlerDeps {
  allowedOrigins: readonly string[]; models: Models;
  authenticate(request: Request): Promise<{ id: string; reader: OwnedReader } | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  insertSample(sample: SampleRow): Promise<SampleRow>;
  parseSuite(value: unknown): Suite; parseManifest(value: unknown): RunManifest;
  canonical(value: unknown): string; sha256(value: string): string;
  normalise(input: ParsedProvider & { latency_ms: number }, task: Task): NormalisedOutput;
  hashOutput(output: NormalisedOutput): string; hashError(error: string): string;
  uuid(): string; versions: { normalisation: string; canonical: string; verdict: string };
  /** Validates secrets/URL now; returned function makes one bounded provider call later. */
  prepareCall(model: Model, body: Record<string, unknown>): () => Promise<ProviderResult>;
}
const STATUS: Record<string, number> = { invalid_input: 400, no_user: 401, not_owner: 403, not_live_run: 403, no_live_access: 403,
  cap_unset: 402, user_cap_exceeded: 402, global_cap_exceeded: 402, user_blocked: 402, deployment_blocked: 402,
  in_flight: 409, billing_unknown: 409, model_not_allowed: 409, config_changed: 409, provider_error: 502, missing_secret: 503 };
export class RunTaskError extends Error {
  code: string; names?: string[];
  constructor(code: string, names?: string[]) { super(code); this.code = code; this.names = names; }
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value);
export function parseRequest(value: unknown): RunTaskRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RunTaskError('invalid_input');
  const data = value as Record<string, unknown>;
  const keys = data.op === 'create_run' ? ['op', 'suite_id', 'old_model_id', 'new_model_id', 'k'] : ['op', 'run_id', 'task_id', 'side', 'sample', 'request_id'];
  if (Object.keys(data).length !== keys.length || Object.keys(data).some((key) => !keys.includes(key))) throw new RunTaskError('invalid_input');
  if (data.op === 'create_run' && uuid(data.suite_id) && typeof data.old_model_id === 'string' && data.old_model_id.length > 0 && data.old_model_id.length <= 256 &&
    typeof data.new_model_id === 'string' && data.new_model_id.length > 0 && data.new_model_id.length <= 256 && [1, 3, 5].includes(data.k as number)) return data as RunTaskRequest;
  if (data.op === 'sample' && uuid(data.run_id) && id(data.task_id) && ['old', 'new'].includes(data.side as string) &&
    Number.isInteger(data.sample) && (data.sample as number) >= 1 && (data.sample as number) <= 5 && uuid(data.request_id)) return data as RunTaskRequest;
  throw new RunTaskError('invalid_input');
}
function liveModel(models: Models, id: string): Model {
  const model = models.models.find((entry) => entry.id === id);
  if (!model || model.provider === 'mock') throw new RunTaskError('model_not_allowed');
  if (id.startsWith('placeholder:') || estimateSpend(model, { serialized_request: '{}', message_count: 1 }).status !== 'known') throw new RunTaskError('billing_unknown');
  return { ...model, check_prices: model.prices };
}
function codeOf(error: unknown): string {
  if (error instanceof RunTaskError) return Object.hasOwn(STATUS, error.code) ? error.code : 'provider_error';
  const message = error instanceof Error ? error.message : '';
  return Object.hasOwn(STATUS, message) ? message : 'provider_error';
}
export async function handleRunTask(request: Request, deps: HandlerDeps): Promise<Response> {
  const headers = corsHeaders(request.headers.get('Origin'), deps.allowedOrigins);
  const respond = (body: RunTaskResponse, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (headers === null) return respond({ attempt_id: null, status: 'error', error_code: 'invalid_input' }, 400);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return respond({ attempt_id: null, status: 'error', error_code: 'invalid_input' }, 400);
  let attemptId: string | null = null, ledger: RunTaskResponse['ledger_outcome'];
  let failedSample: Omit<SampleRow, 'raw' | 'normalised' | 'output_sha256' | 'error'> | null = null, sampleStored = false;
  let receivedRaw: unknown = null;
  let phase: 'none' | 'claimed' | 'dispatching' | 'dispatched' | 'finished' = 'none';
  try {
    const user = await deps.authenticate(request);
    if (!user) throw new RunTaskError('no_user');
    const reader = request.body?.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', size = 0;
    if (reader) try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 16384) { await reader.cancel(); throw new RunTaskError('invalid_input'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) { if (error instanceof RunTaskError) throw error; throw new RunTaskError('invalid_input'); }
    finally { reader.releaseLock(); }
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch { throw new RunTaskError('invalid_input'); }
    const input = parseRequest(value);
    if (input.op === 'create_run') {
      const suiteRow = await user.reader.suite(input.suite_id);
      if (!suiteRow || suiteRow.owner_id !== user.id) throw new RunTaskError('not_owner');
      const suite = deps.parseSuite(suiteRow.body), suiteHash = deps.sha256(deps.canonical(suite));
      if (suiteHash !== suiteRow.sha256) throw new RunTaskError('invalid_input');
      const old = liveModel(deps.models, input.old_model_id), next = liveModel(deps.models, input.new_model_id);
      const manifest = deps.parseManifest({ run_id: deps.uuid(), suite_sha256: suiteHash, models_config_sha256: deps.sha256(deps.canonical(deps.models)),
        k: input.k, mode: 'live', old_model: old, new_model: next, normalisation_version: deps.versions.normalisation,
        canonical_version: deps.versions.canonical, verdict_rule_version: deps.versions.verdict, seed: 20261024 });
      const result = await deps.rpc('create_run', { p_owner: user.id, p_suite_id: input.suite_id, p_old_model: old.id, p_new_model: next.id, p_k: input.k, p_manifest: manifest });
      if (!result.run) throw new RunTaskError('provider_error');
      return respond({ attempt_id: null, status: 'created', run: result.run });
    }
    const run = await user.reader.run(input.run_id);
    if (!run || run.owner_id !== user.id) throw new RunTaskError('not_owner');
    if (run.mode !== 'live') throw new RunTaskError('not_live_run');
    const manifest = deps.parseManifest(run.manifest);
    if (manifest.models_config_sha256 !== deps.sha256(deps.canonical(deps.models))) throw new RunTaskError('config_changed');
    if (manifest.run_id !== run.id || manifest.k !== run.k || manifest.suite_sha256 !== run.suite_sha256) throw new RunTaskError('invalid_input');
    if (input.sample > manifest.k) throw new RunTaskError('invalid_input');
    const suiteRow = await user.reader.suite(run.suite_id);
    if (!suiteRow || suiteRow.owner_id !== user.id) throw new RunTaskError('not_owner');
    const suite = deps.parseSuite(suiteRow.body);
    if (deps.sha256(deps.canonical(suite)) !== run.suite_sha256) throw new RunTaskError('config_changed');
    const task = suite.tasks.find((item) => item.id === input.task_id);
    if (!task) throw new RunTaskError('invalid_input');
    const model = liveModel(deps.models, input.side === 'old' ? manifest.old_model.id : manifest.new_model.id);
    // Full frozen model equality also rejects a forged/inconsistent manifest, independently of the config hash.
    if (deps.canonical(model) !== deps.canonical(input.side === 'old' ? manifest.old_model : manifest.new_model)) throw new RunTaskError('config_changed');
    const mismatch = capabilityMismatch(model, task);
    const body = mismatch ? {} : buildRequest(model, task);
    const estimate = estimateSpend(model, { serialized_request: deps.canonical(body), message_count: task.messages.length });
    if (estimate.status !== 'known') throw new RunTaskError('billing_unknown');
    const call = mismatch ? null : deps.prepareCall(model, body);
    const claim = await deps.rpc('claim_and_reserve', { p_run: run.id, p_task: task.id, p_side: input.side, p_sample: input.sample,
      p_reserve_usd: mismatch ? 0 : estimate.usd, p_request_id: input.request_id });
    attemptId = claim.attempt_id ?? claim.attempt?.id ?? null;
    if (claim.outcome === 'sample_exists') return respond({ attempt_id: attemptId, status: 'sample_exists', sample: claim.sample });
    if (claim.outcome === 'replay') return respond({ attempt_id: attemptId, status: claim.status ?? claim.attempt?.status ?? 'claimed' });
    if (claim.outcome !== 'claimed' || !attemptId) throw new RunTaskError('provider_error');
    phase = 'claimed';
    const sampleKey = { owner_id: user.id, run_id: run.id, task_id: task.id, side: input.side, sample: input.sample };
    failedSample = sampleKey;
    const store = async (error: string | null, raw: unknown, output: NormalisedOutput | null): Promise<SampleRow> => {
      const saved = await deps.insertSample({ ...sampleKey, raw, normalised: output, error, output_sha256: output ? deps.hashOutput(output) : deps.hashError(error ?? 'provider_error') });
      sampleStored = true; return saved;
    };
    if (mismatch) {
      const sample = await store('capability_mismatch', null, null);
      await deps.rpc('release_attempt', { p_attempt: attemptId }); phase = 'finished';
      return respond({ attempt_id: attemptId, status: 'released', sample, ledger_outcome: 'released' });
    }
    phase = 'dispatching';
    const dispatch = await deps.rpc('mark_dispatched', { p_attempt: attemptId });
    if (dispatch.outcome !== 'dispatched') { phase = 'finished'; return respond({ attempt_id: attemptId, status: dispatch.status ?? dispatch.attempt?.status ?? 'dispatched' }); }
    phase = 'dispatched';
    const result = await call!();
    receivedRaw = result.raw;
    const amount = actualCost(model, result.accounting);
    // Canonical usage cannot express cache billing categories. Keep reported detail in raw and abstain
    // from cost checks when the token-only core cannot reproduce the bill; ledger accounting stays exact.
    let output: NormalisedOutput | null = null;
    if (result.ok && result.parsed) try {
      output = deps.normalise({ ...result.parsed,
        usage: amount === null || result.accounting.billing.cache_write_tokens > 0 ? null : result.accounting.usage,
        latency_ms: result.latency_ms }, task);
    } catch { /* Invalid canonical output is a recorded error; received raw and billing remain valid evidence. */ }
    const sample = await store(output ? null : 'provider_error', result.raw, output);
    if (amount === null) {
      await deps.rpc('mark_unknown_liability', { p_attempt: attemptId }); phase = 'finished'; ledger = 'unknown_liability';
      return respond({ attempt_id: attemptId, status: 'unknown_liability', sample, error_code: 'provider_error', ledger_outcome: ledger }, 502);
    }
    const settled = await deps.rpc('settle_attempt', { p_attempt: attemptId, p_actual_usd: amount }); phase = 'finished'; ledger = 'settled';
    return respond({ attempt_id: attemptId, status: settled.status ?? 'settled', sample, ledger_outcome: ledger,
      ...(!output ? { error_code: 'provider_error' } : {}) }, output ? 200 : 502);
  } catch (error) {
    const code = codeOf(error);
    if (failedSample && !sampleStored && phase === 'dispatched') {
      try { await deps.insertSample({ ...failedSample, raw: receivedRaw, normalised: null, error: 'provider_error', output_sha256: deps.hashError('provider_error') } as SampleRow); } catch { /* Reservation remains accountable even if persistence is unavailable. */ }
    }
    if (attemptId && phase !== 'none' && phase !== 'finished') {
      try {
        if (phase === 'claimed') { await deps.rpc('release_attempt', { p_attempt: attemptId }); ledger = 'released'; }
        else if (phase === 'dispatching') {
          // No provider call happened yet. A lost mark-dispatched acknowledgement may leave either state.
          try { await deps.rpc('release_attempt', { p_attempt: attemptId }); ledger = 'released'; }
          catch { await deps.rpc('mark_unknown_liability', { p_attempt: attemptId }); ledger = 'unknown_liability'; }
        } else { await deps.rpc('mark_unknown_liability', { p_attempt: attemptId }); ledger = 'unknown_liability'; }
      } catch { ledger = 'unknown_liability'; /* Retain reservation when transition acknowledgement is uncertain. */ }
    }
    return respond({ attempt_id: attemptId, status: 'error', error_code: code, ...(ledger ? { ledger_outcome: ledger } : {}),
      ...(error instanceof RunTaskError && error.names ? { missing_secrets: error.names } : {}) }, STATUS[code] ?? 502);
  }
}
