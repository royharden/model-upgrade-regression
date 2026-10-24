import { describe, expect, it } from 'vitest';
import { handleRunTask, parseRequest, RunTaskError } from '../../supabase/functions/run-task/handler.ts';
import { canonical } from '../../src/core/regressdiff/canonical.ts';
import { sha256 } from '../../src/core/regressdiff/hash.ts';
import { prepareLiveCall } from '../../supabase/functions/run-task/live-call.ts';
import { fakeHandler, request, sampleBody, createBody, attemptId, owner, suiteId } from './fakes.ts';

function refreezeModel({ deps, state }: ReturnType<typeof fakeHandler>): void {
  const model = deps.models.models[0];
  state.run!.manifest.old_model = { ...structuredClone(model), check_prices: structuredClone(model.prices) };
  state.run!.manifest.new_model = { ...structuredClone(model), check_prices: structuredClone(model.prices) };
  state.run!.manifest.models_config_sha256 = sha256(canonical(deps.models));
}
function rawFixture(raw: unknown, provider: 'anthropic' | 'openai_compatible') {
  const fixture = fakeHandler(), { deps, state } = fixture;
  deps.models.models[0].provider = provider; refreezeModel(fixture);
  const secrets: Record<string, string> = { ANTHROPIC_API_KEY: 'synthetic-key', OPENAI_COMPAT_API_KEY: 'synthetic-key',
    OPENAI_COMPAT_BASE_URL: 'https://api.example.com/v1', OPENAI_COMPAT_ALLOWED_HOSTS: 'api.example.com' };
  const fake = (async () => { state.calls.push('fetch'); return new Response(JSON.stringify(raw)); }) as typeof fetch;
  deps.prepareCall = (model, body) => prepareLiveCall(model, body, (name) => secrets[name], fake);
  return fixture;
}

describe('run-task strict authenticated contract (authored, not executed during construction)', () => {
  it('rejects client-selected prompts, prices, URLs, unsupported k, malformed IDs and extra properties', () => {
    for (const body of [{ ...sampleBody, messages: [] }, { ...createBody, prices: {} }, { ...sampleBody, url: 'https://evil.example' },
      { ...createBody, k: 2 }, { ...sampleBody, request_id: 'not-a-uuid' }, { ...sampleBody, sample: 0 }, { ...sampleBody, task_id: '../task' }]) expect(() => parseRequest(body)).toThrow('invalid_input');
  });
  it('400 invalid_input and refuses unlisted CORS origins before auth', async () => {
    const { deps, state } = fakeHandler();
    const response = await handleRunTask(request({}, 'https://evil.example'), deps);
    expect(response.status).toBe(400); expect((await response.json()).error_code).toBe('invalid_input'); expect(state.calls).toEqual([]);
  });
  it('401 no_user', async () => {
    const { deps, state } = fakeHandler(); state.authenticated = false;
    const response = await handleRunTask(request(), deps); expect(response.status).toBe(401); expect((await response.json()).error_code).toBe('no_user'); expect(state.calls).toEqual([]);
  });
  it('403 not_owner for invisible run or suite, before service writes', async () => {
    for (const create of [false, true]) {
      const { deps, state } = fakeHandler(); state.run = null; state.suite = null;
      const response = await handleRunTask(request(create ? createBody : sampleBody), deps);
      expect(response.status).toBe(403); expect((await response.json()).error_code).toBe('not_owner'); expect(state.calls).toEqual([]);
    }
  });
  it('403 not_live_run', async () => {
    const { deps, state } = fakeHandler(); state.run!.mode = 'demo';
    const response = await handleRunTask(request(), deps); expect(response.status).toBe(403); expect((await response.json()).error_code).toBe('not_live_run');
  });
  for (const [code, status] of [['no_live_access', 403], ['cap_unset', 402], ['user_cap_exceeded', 402], ['global_cap_exceeded', 402], ['user_blocked', 402], ['deployment_blocked', 402], ['in_flight', 409]] as const) {
    it(`${status} ${code}, no dispatch when atomic claim refuses`, async () => {
      const { deps, state } = fakeHandler(); state.rpcFailure = code;
      const response = await handleRunTask(request(), deps);
      expect(response.status).toBe(status); expect((await response.json()).error_code).toBe(code); expect(state.calls).toEqual(['claim_and_reserve']);
    });
  }
  it('409 billing_unknown for unverified placeholder; 409 model_not_allowed for missing or mock', async () => {
    const { deps } = fakeHandler(); deps.models.models[0].prices!.verified_date = null;
    let response = await handleRunTask(request(createBody), deps); expect(response.status).toBe(409); expect((await response.json()).error_code).toBe('billing_unknown');
    for (const provider of ['missing', 'mock']) {
      if (provider === 'mock') deps.models.models[0].provider = 'mock';
      response = await handleRunTask(request({ ...createBody, old_model_id: provider === 'missing' ? 'unknown' : createBody.old_model_id }), deps);
      expect(response.status).toBe(409); expect((await response.json()).error_code).toBe('model_not_allowed');
    }
  });
  it('409 config_changed pauses before reservation', async () => {
    const { deps, state } = fakeHandler(); state.run!.manifest.models_config_sha256 = 'f'.repeat(64);
    const response = await handleRunTask(request(), deps); expect(response.status).toBe(409); expect((await response.json()).error_code).toBe('config_changed'); expect(state.calls).toEqual([]);
  });
  it('503 missing_secret exposes names only and never reserves', async () => {
    const { deps, state } = fakeHandler(); deps.prepareCall = () => { throw new RunTaskError('missing_secret', ['ANTHROPIC_API_KEY']); };
    const response = await handleRunTask(request(), deps); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error_code: 'missing_secret', missing_secrets: ['ANTHROPIC_API_KEY'] }); expect(state.calls).toEqual([]);
  });
  it('builds the entire manifest server-side with exact SQL parameter names', async () => {
    const { deps, state } = fakeHandler(); const response = await handleRunTask(request(createBody), deps);
    expect(response.status).toBe(200); expect((await response.json()).status).toBe('created');
    const call = state.rpcArgs[0]; expect(call.name).toBe('create_run');
    expect(call.args).toMatchObject({ p_owner: owner, p_suite_id: suiteId, p_old_model: 'synthetic-live', p_new_model: 'synthetic-live', p_k: 3 });
    expect(call.args.p_manifest).toMatchObject({ mode: 'live', models_config_sha256: sha256(canonical(deps.models)), old_model: { ...deps.models.models[0], check_prices: deps.models.models[0].prices } });
  });
  it('one successful dispatch stores canonical output and settles reported cost', async () => {
    const { deps, state } = fakeHandler(); const response = await handleRunTask(request(), deps);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ attempt_id: attemptId, status: 'settled', ledger_outcome: 'settled' });
    expect(state.calls).toEqual(['claim_and_reserve', 'mark_dispatched', 'fetch', 'insertSample', 'settle_attempt']);
    expect(state.samples[0].normalised?.text).toBe('OK');
    expect(state.rpcArgs.at(-1)).toEqual({ name: 'settle_attempt', args: { p_attempt: attemptId, p_actual_usd: 0.000018 } });
  });
  it('claim replay and mark-dispatched replay never fetch, even across process requests', async () => {
    for (const replayAtClaim of [false, true]) {
      const { deps, state } = fakeHandler();
      if (replayAtClaim) state.claim = { outcome: 'replay', attempt_id: attemptId, status: 'dispatched' };
      else state.dispatched = { outcome: 'replay', status: 'dispatched' };
      await handleRunTask(request(), deps); expect(state.calls).not.toContain('fetch'); expect(state.samples).toEqual([]);
    }
  });
  it('returns existing sample without dispatch', async () => {
    const { deps, state } = fakeHandler(); state.claim = { outcome: 'sample_exists', sample: { owner_id: owner, run_id: sampleBody.run_id, task_id: 'one', side: 'old', sample: 1, raw: null, normalised: null, error: 'previous', output_sha256: 'a'.repeat(64) } };
    const response = await handleRunTask(request(), deps); expect((await response.json()).status).toBe('sample_exists'); expect(state.calls).toEqual(['claim_and_reserve']);
  });
  it('records unsupported tools as capability_mismatch and releases without dispatch', async () => {
    const { deps, state } = fakeHandler(); deps.models.models[0].supports_tools = false;
    state.run!.manifest.old_model.supports_tools = false; state.run!.manifest.new_model.supports_tools = false;
    state.run!.manifest.models_config_sha256 = sha256(canonical(deps.models));
    const body = state.suite!.body as { tasks: { tools: unknown[] }[] }; body.tasks[0].tools = [{ name: 'tool', description: 'Data only', input_schema: { type: 'object' } }];
    state.run!.suite_sha256 = sha256(canonical(body)); state.run!.manifest.suite_sha256 = state.run!.suite_sha256;
    const response = await handleRunTask(request(), deps); expect(await response.json()).toMatchObject({ ledger_outcome: 'released', sample: { error: 'capability_mismatch' } });
    expect(state.calls).toEqual(['claim_and_reserve', 'insertSample', 'release_attempt']);
  });
  it('502 provider_error with reported usage settles; missing usage retains liability', async () => {
    for (const withUsage of [false, true]) {
      const { deps, state } = fakeHandler(); state.provider.ok = false; if (!withUsage) state.provider.parsed!.usage = null;
      const response = await handleRunTask(request(), deps); expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error_code: 'provider_error', ledger_outcome: withUsage ? 'settled' : 'unknown_liability' });
      expect(state.samples[0].error).toBe('provider_error'); expect(state.calls.filter((call) => call === 'fetch')).toHaveLength(1);
    }
  });
  it.each(['anthropic', 'openai_compatible'] as const)('settles %s malformed-tool errors from independent usage and retains the complete raw response', async (provider) => {
    const raw = provider === 'anthropic'
      ? { content: [{ type: 'tool_use', name: 'lookup' }], usage: { input_tokens: 10, output_tokens: 2 } }
      : { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'lookup', arguments: 'not-json' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 } };
    const { deps, state } = rawFixture(raw, provider);
    const response = await handleRunTask(request(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 'settled', ledger_outcome: 'settled', error_code: 'provider_error',
      sample: { raw, normalised: null, error: 'provider_error' } });
    expect(state.samples).toHaveLength(1);
    expect(state.samples[0].output_sha256).toBe(deps.hashError('provider_error'));
    expect(state.calls).toEqual(['claim_and_reserve', 'mark_dispatched', 'fetch', 'insertSample', 'settle_attempt']);
    expect(state.rpcArgs.at(-1)).toEqual({ name: 'settle_attempt', args: { p_attempt: attemptId, p_actual_usd: 0.000018 } });
  });
  it('records normalization failure without losing raw data or a known bill', async () => {
    // The provider JSON is valid, but the core cannot normalize this decoded string as tool arguments.
    const raw = { choices: [{ message: { content: 'OK', tool_calls: [{ type: 'function', function: { name: 'lookup', arguments: '"not-json"' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 } };
    const { deps, state } = rawFixture(raw, 'openai_compatible');
    const response = await handleRunTask(request(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ledger_outcome: 'settled', error_code: 'provider_error', sample: { raw, normalised: null, error: 'provider_error' } });
    expect(state.samples).toHaveLength(1);
    expect(state.samples[0].raw).toEqual(raw);
    expect(state.samples[0].output_sha256).toBe(deps.hashError('provider_error'));
    expect(state.calls).toEqual(['claim_and_reserve', 'mark_dispatched', 'fetch', 'insertSample', 'settle_attempt']);
    expect(state.rpcArgs.at(-1)?.args.p_actual_usd).toBe(0.000018);
  });
  it.each([undefined, 0])('separate reasoning count %s distinguishes unknown liability from an explicit zero bill', async (reasoning_tokens) => {
    const raw = { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2,
      completion_tokens_details: reasoning_tokens === undefined ? {} : { reasoning_tokens } } };
    const fixture = rawFixture(raw, 'openai_compatible'), { deps, state } = fixture;
    Object.assign(deps.models.models[0].prices!, { reasoning_in_output_tokens: false, reasoning_per_mtok: 2 }); refreezeModel(fixture);
    const response = await handleRunTask(request(), deps);
    const known = reasoning_tokens === 0;
    expect(response.status).toBe(known ? 200 : 502);
    expect(await response.json()).toMatchObject({ ledger_outcome: known ? 'settled' : 'unknown_liability', sample: { raw,
      normalised: { usage: known ? { input_tokens: 10, output_tokens: 2, reasoning_tokens: 0 } : null } } });
    expect(state.calls.at(-1)).toBe(known ? 'settle_attempt' : 'mark_unknown_liability');
    expect(state.calls).not.toContain('release_attempt');
    if (known) expect(state.rpcArgs.at(-1)?.args.p_actual_usd).toBe(0.000018);
    else expect(state.calls).not.toContain('settle_attempt');
  });
  it('refuses a missing separate reasoning rate before reservation instead of allowing zero-cost settlement', async () => {
    for (const create of [false, true]) {
      const fixture = fakeHandler(), { deps, state } = fixture;
      deps.models.models[0].prices!.reasoning_in_output_tokens = false; refreezeModel(fixture);
      const response = await handleRunTask(request(create ? createBody : sampleBody), deps);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error_code: 'billing_unknown' });
      expect(state.calls).toEqual([]);
    }
  });
  it('retains unknown liability and raw terminal error evidence when malformed output also lacks billing', async () => {
    const raw = { content: [{ type: 'tool_use', name: 'lookup' }] };
    const { deps, state } = rawFixture(raw, 'anthropic');
    const response = await handleRunTask(request(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ledger_outcome: 'unknown_liability', sample: { raw, normalised: null, error: 'provider_error' } });
    expect(state.calls).toEqual(['claim_and_reserve', 'mark_dispatched', 'fetch', 'insertSample', 'mark_unknown_liability']);
  });
  it('post-dispatch timeout/network failure records error, retains reservation, and never retries', async () => {
    const { deps, state } = fakeHandler(); deps.prepareCall = () => async () => { state.calls.push('fetch'); throw new Error('network detail must not leak'); };
    const response = await handleRunTask(request(), deps); expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error_code: 'provider_error', ledger_outcome: 'unknown_liability' });
    expect(state.calls).toEqual(['claim_and_reserve', 'mark_dispatched', 'fetch', 'insertSample', 'mark_unknown_liability']);
  });
  it('known cache-write bill settles actual ledger amount but cost checks abstain on unrepresentable token categories', async () => {
    const { deps, state } = fakeHandler(); deps.models.models[0].prices!.cache_write_per_mtok = 3;
    state.run!.manifest.old_model = { ...structuredClone(deps.models.models[0]), check_prices: deps.models.models[0].prices };
    state.run!.manifest.models_config_sha256 = sha256(canonical(deps.models));
    state.provider.parsed!.billing.cache_write_tokens = 5;
    const response = await handleRunTask(request(), deps);
    expect(await response.json()).toMatchObject({ ledger_outcome: 'settled', sample: { normalised: { usage: null } } });
    expect(state.rpcArgs.at(-1)).toEqual({ name: 'settle_attempt', args: { p_attempt: attemptId, p_actual_usd: 0.000033 } });
  });
  it('unknown special billing retains liability and normalized cost checks abstain', async () => {
    const { deps, state } = fakeHandler(); state.provider.parsed!.billing.unmodelled = true;
    const response = await handleRunTask(request(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ledger_outcome: 'unknown_liability', sample: { normalised: { usage: null } } });
    expect(state.calls).not.toContain('settle_attempt');
  });
  it('preserves overrun state returned by atomic settlement', async () => {
    const { deps } = fakeHandler(), rpc = deps.rpc;
    deps.rpc = async (name, args) => name === 'settle_attempt' ? { outcome: 'settled', status: 'overrun' } : rpc(name, args);
    const response = await handleRunTask(request(), deps); expect(await response.json()).toMatchObject({ status: 'overrun', ledger_outcome: 'settled' });
  });
  it('failed dispatch marker before fetch releases a still-claimed reservation', async () => {
    const { deps, state } = fakeHandler(), rpc = deps.rpc;
    deps.rpc = async (name, args) => { if (name === 'mark_dispatched') { state.calls.push(name); throw new Error('marker failed'); } return rpc(name, args); };
    const response = await handleRunTask(request(), deps); expect(await response.json()).toMatchObject({ error_code: 'provider_error', ledger_outcome: 'released' });
    expect(state.calls).toEqual(['claim_and_reserve', 'mark_dispatched', 'release_attempt']);
  });
  it('pre-dispatch persistence failure releases the claimed reservation', async () => {
    const { deps, state } = fakeHandler(); deps.models.models[0].provider = 'openai_compatible'; deps.models.models[0].reasoning_budget = 100;
    state.run!.manifest.old_model = { ...structuredClone(deps.models.models[0]), check_prices: deps.models.models[0].prices }; state.run!.manifest.new_model = { ...structuredClone(deps.models.models[0]), check_prices: deps.models.models[0].prices }; state.run!.manifest.models_config_sha256 = sha256(canonical(deps.models));
    deps.insertSample = async () => { throw new Error('database unavailable'); };
    const response = await handleRunTask(request(), deps); expect(await response.json()).toMatchObject({ error_code: 'provider_error', ledger_outcome: 'released' });
    expect(state.calls).toEqual(['claim_and_reserve', 'release_attempt']);
  });
});
