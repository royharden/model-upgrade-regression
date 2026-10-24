import { describe, expect, it } from 'vitest';
import { LiveDriver, type LivePort } from '../../src/lib/live-driver.ts';
import { createManifest } from '../../src/core/regressdiff/compare.ts';
import { SuiteSchema } from '../../src/core/regressdiff/schema/suite.ts';
import { makeSample } from '../../src/core/regressdiff/pairing.ts';
import type { StoredRun } from '../../src/lib/store/types.ts';
import type { Attempt, SampleRequest, SampleResponse } from '../../src/lib/store/supabase.ts';

const suite = SuiteSchema.parse({ id: 'driver-suite', name: 'Driver', tasks: [{ id: 'task', category: 'format', messages: [{ role: 'user', content: 'Hi' }], tools: [], checks: [{ id: 'check', type: 'contains', params: { value: 'Hi' } }], independent_tool_calls: false }] });
const args = { k: 3 as const, old_model: 'mock:old', new_model: 'mock:new' };
const run: StoredRun = { id: 'run', owner_id: 'owner', suite, args, manifest: { ...createManifest(suite, 'run', args), mode: 'live' } };
const sample = makeSample('run', 'old', { task_id: 'task', sample: 1, output: null, error: 'recorded' });
const attempt = (status: string): Attempt => ({ id: 'attempt', task_id: 'task', side: 'old', sample: 2, status, reserve_usd: 0.1 });
const tick = () => Promise.resolve();
describe('browser queue paid-call boundaries', () => {
  it('resumes only missing keys with at most two concurrent calls and fresh request ids', async () => {
    const requests: SampleRequest[] = [], releases: (() => void)[] = []; let active = 0, max = 0, sequence = 0;
    const port: LivePort = { listSamples: async () => [sample], attempts: async () => [], sample: async (request) => {
      requests.push(request); active++; max = Math.max(max, active);
      await new Promise<void>((resolve) => releases.push(resolve)); active--;
      return { attempt_id: request.request_id, status: 'settled', sample: { error: null } };
    } };
    const result = new LiveDriver().run(run, port, () => {}, { requestId: () => `request-${++sequence}` });
    await tick(); await tick(); expect(requests).toHaveLength(2);
    for (let index = 0; index < 6; index++) { releases.splice(0).forEach((release) => release()); await tick(); await tick(); }
    expect((await result).state).toBe('complete'); expect(max).toBe(2); expect(requests).toHaveLength(5);
    expect(requests.some((request) => request.side === 'old' && request.sample === 1)).toBe(false);
    expect(new Set(requests.map((request) => request.request_id)).size).toBe(5);
  });
  it.each(['config_changed', 'provider_error', 'transport_outcome_unknown'])('pauses on %s with no automatic retry', async (code) => {
    let calls = 0;
    const port: LivePort = { listSamples: async () => [], attempts: async () => [], sample: async () => { calls++; throw new Error(code); } };
    const result = await new LiveDriver().run(run, port, () => {}, { requestId: () => 'fresh' });
    expect(result).toMatchObject({ state: 'paused', reason: code }); expect(calls).toBe(2);
  });
  it('retains unknown liability, requires user retry and blocks an in-flight attempt even after confirmation', async () => {
    let calls = 0, history = [attempt('unknown_liability')]; const ids: string[] = [];
    const port: LivePort = { listSamples: async () => [], attempts: async () => history, sample: async (request) => {
      calls++; ids.push(request.request_id); return { attempt_id: request.request_id, status: 'settled', sample: { error: null } };
    } };
    const driver = new LiveDriver();
    expect((await driver.run(run, port, () => {})).reason).toBe('retry_requires_confirmation'); expect(calls).toBe(0);
    let id = 0; expect((await driver.run(run, port, () => {}, { retryFailed: true, requestId: () => `retry-${++id}` })).state).toBe('complete');
    expect(new Set(ids).size).toBe(6); expect(history[0].status).toBe('unknown_liability');
    history = [attempt('dispatched')]; calls = 0;
    expect((await driver.run(run, port, () => {}, { retryFailed: true })).reason).toBe('in_flight'); expect(calls).toBe(0);
  });
  it('preserves config_changed when the other in-flight request fails differently', async () => {
    let calls = 0;
    const port: LivePort = { listSamples: async () => [], attempts: async () => [], sample: async () => { throw new Error(++calls === 1 ? 'config_changed' : 'provider_error'); } };
    expect((await new LiveDriver().run(run, port, () => {})).reason).toBe('config_changed'); expect(calls).toBe(2);
  });
  it('pauses a caller stop without aborting the two dispatched requests', async () => {
    const driver = new LiveDriver(), releases: (() => void)[] = []; let calls = 0;
    const port: LivePort = { listSamples: async () => [], attempts: async () => [], sample: async () => {
      calls++; await new Promise<void>((resolve) => releases.push(resolve)); return { attempt_id: 'id', status: 'settled', sample: { error: null } };
    } };
    const pending = driver.run(run, port, () => {}); await tick(); await tick(); driver.pause();
    releases.forEach((resolve) => resolve()); const result = await pending;
    expect(calls).toBe(2); expect(result).toMatchObject({ state: 'paused', completed: 2, reason: 'user_paused' });
  });
  const failedResponses: SampleResponse[] = [
    { attempt_id: 'id', status: 'unknown_liability', sample: { error: null }, ledger_outcome: 'unknown_liability' },
    { attempt_id: 'id', status: 'overrun', sample: { error: null }, ledger_outcome: 'settled' },
    { attempt_id: 'id', status: 'settled' },
    { attempt_id: 'id', status: 'released', sample: { error: 'capability_mismatch' } },
  ];
  it.each(failedResponses)('stops on uncertain or failed responses without draining the queue ($status)', async (response) => {
    let calls = 0;
    const port: LivePort = { listSamples: async () => [], attempts: async () => [], sample: async () => { calls++; return response; } };
    expect((await new LiveDriver().run(run, port, () => {})).state).toBe('paused'); expect(calls).toBe(2);
  });
});
