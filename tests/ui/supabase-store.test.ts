import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { canonical } from '../../src/core/regressdiff/canonical.ts';
import { sha256, hashError } from '../../src/core/regressdiff/hash.ts';
import { SuiteSchema } from '../../src/core/regressdiff/schema/suite.ts';
import { createManifest } from '../../src/core/regressdiff/compare.ts';
import { replayRulings, RulingEventSchema } from '../../src/core/regressdiff/rulings.ts';
import { SupabaseStore, suiteDatabaseId, sampleFromRow } from '../../src/lib/store/supabase.ts';
const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const suite = SuiteSchema.parse({ id: 'saved-suite', name: 'Synthetic', tasks: [{ id: 'task', category: 'format', messages: [{ role: 'user', content: 'Hi' }], tools: [], checks: [{ id: 'check', type: 'contains', params: { value: 'Hi' } }], independent_tool_calls: false }] });
type Row = Record<string, unknown>;
interface FakeQuery {
  select(columns: string): FakeQuery; order(column: string): FakeQuery; range(from: number, to: number): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  maybeSingle(): Promise<{ data: Row | null; error: null }>;
  insert(value: Row): Promise<{ data: null; error: null }>;
  then(resolve: (value: { data: Row[]; error: null }) => unknown): Promise<unknown>;
}
function fixture() {
  const rows: Record<string, Row[]> = { suites: [], runs: [], samples: [], rulings: [], call_attempts: [], budgets: [] };
  const writes: { table: string; value: Row }[] = [], reads: { table: string; column: string; value: unknown }[] = [];
  const invoke = vi.fn(), rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];
    const matching = () => rows[table].filter((row) => filters.every(([column, value]) => row[column] === value));
    const result = (): { data: Row[]; error: null } => ({ data: matching().slice(range[0], range[1] + 1), error: null });
    const query: FakeQuery = { select: () => query, order: () => query, range: (from: number, to: number) => { range = [from, to]; return query; },
      eq: (column: string, value: unknown) => { filters.push([column, value]); reads.push({ table, column, value }); return query; },
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      insert: async (value: Row) => { writes.push({ table, value }); rows[table].push(value); return { data: null, error: null }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  };
  const client = { from, functions: { invoke }, rpc } as unknown as SupabaseClient;
  return { store: new SupabaseStore(client, owner), rows, writes, reads, invoke, rpc };
}
async function seedRun(store: SupabaseStore, rows: Record<string, Row[]>, id: string) {
  const args = { k: 1 as const, old_model: 'mock:old', new_model: 'mock:new' };
  await store.saveSuite(suite);
  rows.runs.push({ id, owner_id: owner, suite_id: suiteDatabaseId(owner, suite.id), suite_sha256: sha256(canonical(suite)), mode: 'live',
    old_model: args.old_model, new_model: args.new_model, k: 1, manifest: { ...createManifest(suite, id, args), mode: 'live' } });
}
describe('authenticated Supabase store contracts', () => {
  it('saves an owner-scoped immutable body/hash under stable database UUIDs and rejects changed logical versions', async () => {
    const { store, rows, writes, reads } = fixture(); await store.saveSuite(suite); await store.saveSuite(suite);
    expect(writes).toHaveLength(1); expect(rows.suites[0]).toMatchObject({ owner_id: owner, body: suite, sha256: sha256(canonical(suite)) });
    expect(suiteDatabaseId(owner, suite.id)).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
    expect(suiteDatabaseId('other-owner', suite.id)).not.toBe(suiteDatabaseId(owner, suite.id));
    await expect(store.saveSuite({ ...suite, name: 'changed' })).rejects.toThrow('suite_immutable_choose_new_id');
    expect(await store.getSuite(suite.id)).toEqual(suite);
    expect(reads.filter((read) => read.column === 'owner_id').every((read) => read.value === owner)).toBe(true);
  });
  it('creates runs only through run-task and treats samples as read-only browser evidence', async () => {
    const { store, invoke, writes, rows } = fixture(), args = { k: 1 as const, old_model: 'mock:old', new_model: 'mock:new' };
    const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const manifest = { ...createManifest(suite, id, args), mode: 'live' };
    const row = { id, owner_id: owner, suite_id: suiteDatabaseId(owner, suite.id), suite_sha256: sha256(canonical(suite)), mode: 'live',
      old_model: args.old_model, new_model: args.new_model, k: 1, manifest };
    invoke.mockResolvedValue({ data: { attempt_id: null, status: 'created', run: row }, error: null });
    const run = await store.createRun(suite, args); expect(run.id).toBe(id);
    expect(invoke).toHaveBeenCalledWith('run-task', { body: { op: 'create_run', suite_id: suiteDatabaseId(owner, suite.id), old_model_id: 'mock:old', new_model_id: 'mock:new', k: 1 } });
    expect(writes.every((write) => write.table === 'suites')).toBe(true);
    const errorSample = { run_id: id, owner_id: owner, task_id: 'task', side: 'old', sample: 1, normalised: null, raw: null, error: 'provider_error', output_sha256: hashError('provider_error') };
    rows.samples.push(errorSample); const samples = await store.listSamples(id);
    expect(samples[0].error).toBe('provider_error'); await expect(store.addSample(samples[0])).rejects.toThrow('samples_are_server_only');
    expect(() => sampleFromRow({ ...errorSample, output_sha256: '0'.repeat(64) })).toThrow('sample_hash_mismatch');
  });
  it('changes only caller cap through the narrow RPC and never writes budget columns', async () => {
    const { store, rpc, writes } = fixture(); await store.setCap(1.25); await store.setCap(null);
    expect(rpc).toHaveBeenCalledWith('set_my_cap', { p_cap_usd: 1.25 }); expect(rpc).toHaveBeenCalledWith('set_my_cap', { p_cap_usd: null });
    expect(writes).toEqual([]); await expect(store.setCap(-1)).rejects.toThrow('invalid_cap');
  });
  it('paginates owner attempt history so unknown liability does not disappear after the API row limit', async () => {
    const { store, rows } = fixture();
    rows.call_attempts = Array.from({ length: 1001 }, (_, index) => ({ id: `attempt-${index}`, owner_id: owner, task_id: 'task', side: 'old', sample: 1, status: 'unknown_liability', reserve_usd: '0.01' }));
    rows.call_attempts.push({ id: 'foreign', owner_id: 'other', task_id: 'task', side: 'old', sample: 1, status: 'unknown_liability', reserve_usd: '100' });
    const attempts = await store.attempts(); expect(attempts).toHaveLength(1001);
    expect(attempts.reduce((sum, value) => sum + value.reserve_usd, 0)).toBeCloseTo(10.01, 10);
  });
  it('keeps structured cap/config errors and unknown transport outcomes without leaking raw server details', async () => {
    const { store, invoke } = fixture();
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error_code: 'global_cap_exceeded', private_detail: 'must not show' }) } } });
    await expect(store.invoke({})).rejects.toMatchObject({ code: 'global_cap_exceeded', message: 'global_cap_exceeded' });
    invoke.mockResolvedValue({ data: null, error: { message: 'secret provider body' } });
    await expect(store.invoke({})).rejects.toMatchObject({ code: 'transport_outcome_unknown' });
    invoke.mockResolvedValue({ data: { status: 'error', error_code: 'config_changed' }, error: null });
    await expect(store.invoke({})).rejects.toMatchObject({ code: 'config_changed' });
  });
  it('rejects blank, foreign or invalid ruling writes and inserts valid events without updating history', async () => {
    const { store, rows, writes } = fixture(), id = 'run';
    await seedRun(store, rows, id);
    const ruling = { id: 'event', owner_id: owner, run_id: id, finding_id: 'a'.repeat(64), kind: 'waived' as const, reason: 'Reviewed synthetic evidence', created_at: '2026-10-24T00:00:00.000Z', supersedes: null };
    await expect(store.addRuling({ ...ruling, reason: ' ' })).rejects.toThrow();
    await expect(store.addRuling({ ...ruling, owner_id: 'other' })).rejects.toThrow('not_owner');
    await store.addRuling(ruling); expect(writes.filter((write) => write.table === 'rulings')).toEqual([{ table: 'rulings', value: ruling }]);
    expect(await store.listRulings()).toEqual([{ ...ruling, created_at: '2026-10-24T00:00:00.000000Z' }]);
  });
  it('normalises persisted offset timestamps without losing chronological replay or later cross-run writes', async () => {
    const { store, rows, writes } = fixture(), finding_id = 'a'.repeat(64);
    const oldRun = '11111111-1111-1111-1111-111111111111', newRun = '22222222-2222-2222-2222-222222222222';
    await seedRun(store, rows, oldRun); await seedRun(store, rows, newRun);
    const first = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', owner_id: owner, run_id: oldRun, finding_id,
      kind: 'waived' as const, reason: 'Reviewed persisted evidence', created_at: '2026-10-24T20:00:00.123001+02:00', supersedes: null };
    const equivalent = { ...first, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', kind: 'confirmed' as const,
      created_at: '2026-10-24T14:00:00.123001-04:00' };
    const tombstone = { ...first, id: '00000000-0000-0000-0000-000000000001', kind: 'tombstone' as const,
      created_at: '2026-10-24T18:00:00.123002+00:00', supersedes: first.id };
    // Real DB-shaped rows, deliberately unsorted; insert echoes with Z timestamps missed this failure.
    rows.rulings.push(tombstone, first, equivalent);
    expect(RulingEventSchema.safeParse(first).success).toBe(false);
    const listed = await store.listRulings();
    expect(listed.map((event) => [event.id, event.created_at])).toEqual([
      [equivalent.id, '2026-10-24T18:00:00.123001Z'], [first.id, '2026-10-24T18:00:00.123001Z'],
      [tombstone.id, '2026-10-24T18:00:00.123002Z'],
    ]);
    expect(replayRulings(owner, [finding_id], listed).effective[finding_id].id).toBe(equivalent.id);
    expect(rows.rulings).toEqual([tombstone, first, equivalent]);
    const later = { ...tombstone, id: 'cccccccc-cccc-cccc-cccc-ccccccccccc1', run_id: newRun,
      created_at: '2026-10-24T18:00:00.124Z', supersedes: tombstone.id };
    // A browser millisecond timestamp before the persisted microseconds cannot target a future event.
    await expect(store.addRuling({ ...later, created_at: '2026-10-24T18:00:00.123Z' })).rejects.toThrow('Invalid tombstone target');
    await store.addRuling(later);
    expect(writes.filter((write) => write.table === 'rulings')).toEqual([{ table: 'rulings', value: later }]);
    const replayed = replayRulings(owner, [finding_id], await store.listRulings());
    expect(replayed.audit.map((event) => event.id)).toEqual([equivalent.id, first.id, tombstone.id, later.id]);
    expect(replayed.audit[3].created_at).toBe('2026-10-24T18:00:00.124000Z');
    expect(replayed.effective[finding_id].id).toBe(first.id);
    const foreignOwner = { ...first, id: 'dddddddd-dddd-dddd-dddd-ddddddddddd1', owner_id: '99999999-9999-4999-8999-999999999999' };
    const foreignFinding = { ...first, id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', finding_id: 'b'.repeat(64) };
    rows.rulings.push(foreignOwner, foreignFinding);
    for (const target of [foreignOwner, foreignFinding]) {
      await expect(store.addRuling({ ...later, id: 'ffffffff-ffff-ffff-ffff-fffffffffff1', supersedes: target.id }))
        .rejects.toThrow('Invalid tombstone target');
    }
    expect(writes.filter((write) => write.table === 'rulings')).toHaveLength(1);
  });
  it.each([
    ['2026-10-24T18:00:00+00:00', '2026-10-24T18:00:00.000000Z'],
    ['2026-10-25T00:15:00.12+05:30', '2026-10-24T18:45:00.120000Z'],
  ])('normalises database timestamp %s to UTC across date boundaries', async (created_at, expected) => {
    const { store, rows } = fixture();
    rows.rulings.push({ id: 'event', owner_id: owner, run_id: 'run', finding_id: 'a'.repeat(64), kind: 'confirmed',
      reason: 'Reviewed evidence', created_at, supersedes: null });
    expect((await store.listRulings())[0].created_at).toBe(expected);
  });
  it.each([null, 42, 'not-a-date', '2026-02-30T18:00:00+00:00', '2026-10-24T18:00:00',
    '2026-10-24T18:00:00+25:00', '2026-10-24T18:00:00.1234567+00:00'])('rejects invalid DB ruling timestamps: %s', async (created_at) => {
    const { store, rows } = fixture();
    rows.rulings.push({ id: 'event', owner_id: owner, run_id: 'run', finding_id: 'a'.repeat(64), kind: 'confirmed',
      reason: 'Reviewed evidence', created_at, supersedes: null });
    await expect(store.listRulings()).rejects.toThrow();
  });
});
