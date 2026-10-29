import { canonical, CANONICAL_VERSION } from '../../src/core/regressdiff/canonical.ts';
import { sha256, hashOutput, hashError } from '../../src/core/regressdiff/hash.ts';
import { normalise, NORMALISATION_VERSION } from '../../src/core/regressdiff/normalise.ts';
import { VERDICT_RULE_VERSION } from '../../src/core/regressdiff/verdict.ts';
import { SuiteSchema } from '../../src/core/regressdiff/schema/suite.ts';
import { RunManifestSchema } from '../../src/core/regressdiff/schema/manifest.ts';
import type { HandlerDeps, ProviderResult, RpcResult, RunRow, SampleRow, SuiteRow } from '../../supabase/functions/run-task/handler.ts';
import type { Model, Models } from '../../supabase/functions/run-task/portable/types.ts';
import type { ParsedProvider } from '../../supabase/functions/run-task/portable/parse-common.ts';

export const owner = '10000000-0000-4000-8000-000000000001';
export const suiteId = '20000000-0000-4000-8000-000000000001';
export const runId = '30000000-0000-4000-8000-000000000001';
export const attemptId = '40000000-0000-4000-8000-000000000001';
export const requestId = '50000000-0000-4000-8000-000000000001';
export const sampleBody = { op: 'sample', run_id: runId, task_id: 'one', side: 'old', sample: 1, request_id: requestId };
export const createBody = { op: 'create_run', suite_id: suiteId, old_model_id: 'synthetic-live', new_model_id: 'synthetic-live', k: 3 };
export const liveModel: Model = { id: 'synthetic-live', provider: 'anthropic', max_tokens: 1000, reasoning_budget: 0,
  billing: { reasoning_counts_in_max_tokens: true }, per_message_overhead_bound: 20, sampling_params_supported: ['temperature'], supports_tools: true,
  prices: { currency: 'USD', input_per_mtok: 1, output_per_mtok: 4, verified_date: '2026-10-24', synthetic: false }, check_prices: null };
export function fakeHandler() {
  const suite = SuiteSchema.parse({ id: 'suite', name: 'Synthetic contract', tasks: [{ id: 'one', category: 'format', messages: [{ role: 'user', content: 'Say OK' }], tools: [], checks: [{ id: 'ok', type: 'equals', params: { value: 'OK' } }], independent_tool_calls: false }] });
  const models: Models = { version: 'synthetic-test-only', models: [structuredClone(liveModel)] };
  const manifest = RunManifestSchema.parse({ run_id: runId, suite_sha256: sha256(canonical(suite)), models_config_sha256: sha256(canonical(models)),
    k: 3, mode: 'live', old_model: { ...models.models[0], check_prices: models.models[0].prices }, new_model: { ...models.models[0], check_prices: models.models[0].prices }, seed: 1,
    normalisation_version: NORMALISATION_VERSION, canonical_version: CANONICAL_VERSION, verdict_rule_version: VERDICT_RULE_VERSION });
  const parsed: ParsedProvider = { text: 'OK', thinking: null, tool_calls: [], stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 2 }, billing: { cache_write_tokens: 0, unmodelled: false } };
  const state = {
    authenticated: true, suite: { id: suiteId, owner_id: owner, body: suite, sha256: manifest.suite_sha256 } as SuiteRow | null,
    run: { id: runId, owner_id: owner, suite_id: suiteId, suite_sha256: manifest.suite_sha256, mode: 'live', k: 3, manifest } as RunRow | null,
    calls: [] as string[], rpcArgs: [] as { name: string; args: Record<string, unknown> }[], samples: [] as SampleRow[],
    rpcFailure: '' as string, claim: { outcome: 'claimed', attempt_id: attemptId, status: 'claimed' } as RpcResult,
    dispatched: { outcome: 'dispatched', attempt_id: attemptId, status: 'dispatched' } as RpcResult,
    provider: { ok: true, raw: { synthetic: true }, parsed, accounting: parsed, latency_ms: 10 } as ProviderResult,
  };
  const deps: HandlerDeps = {
    allowedOrigins: ['https://app.example.com'], models,
    authenticate: async () => state.authenticated ? { id: owner, reader: { suite: async () => state.suite, run: async () => state.run } } : null,
    rpc: async (name, args) => {
      state.calls.push(name); state.rpcArgs.push({ name, args });
      if (state.rpcFailure && name === 'claim_and_reserve') throw new Error(state.rpcFailure);
      if (name === 'create_run') return { outcome: 'created', run: { ...state.run!, id: (args.p_manifest as { run_id: string }).run_id, manifest: args.p_manifest as RunRow['manifest'] } };
      if (name === 'claim_and_reserve') return state.claim;
      if (name === 'mark_dispatched') return state.dispatched;
      return { outcome: name === 'settle_attempt' ? 'settled' : name === 'release_attempt' ? 'released' : 'unknown_liability', status: name === 'settle_attempt' ? 'settled' : name === 'release_attempt' ? 'released' : 'unknown_liability' };
    },
    insertSample: async (sample) => { state.calls.push('insertSample'); state.samples.push(sample); return { ...sample, id: 'sample-id' }; },
    parseSuite: (value) => SuiteSchema.parse(value), parseManifest: (value) => RunManifestSchema.parse(value),
    canonical, sha256, normalise, hashOutput, hashError, uuid: () => runId,
    versions: { normalisation: NORMALISATION_VERSION, canonical: CANONICAL_VERSION, verdict: VERDICT_RULE_VERSION },
    prepareCall: () => async () => { state.calls.push('fetch'); return state.provider; },
  };
  return { deps, state };
}
export const request = (body: unknown = sampleBody, origin = 'https://app.example.com'): Request => new Request('https://edge.example.com/run-task', {
  method: 'POST', headers: { Origin: origin, Authorization: 'Bearer synthetic-user-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
