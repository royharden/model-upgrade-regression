import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { canonical } from '../../core/regressdiff/canonical.ts';
import { sha256 } from '../../core/regressdiff/hash.ts';
import { SuiteSchema, type Suite } from '../../core/regressdiff/schema/suite.ts';
import { RunArgsSchema, RunManifestSchema, type RunArgs } from '../../core/regressdiff/schema/manifest.ts';
import { makeSample, type Sample, type Side } from '../../core/regressdiff/pairing.ts';
import { RecordingLineSchema } from '../../core/regressdiff/schema/output.ts';
import { RulingEventSchema, replayRulings, type RulingEvent } from '../../core/regressdiff/rulings.ts';
import type { Store, StoredRun } from './types.ts';

export interface Budget { cap_usd: number | null; reserved_usd: number; spent_usd: number; live_blocked: boolean; blocked_reason: string | null }
export interface Attempt { id: string; task_id: string; side: Side; sample: number; status: string; reserve_usd: number }
export interface SampleRequest { op: 'sample'; run_id: string; task_id: string; side: Side; sample: number; request_id: string }
export interface SampleResponse { attempt_id: string | null; status: string; sample?: unknown; error_code?: string; ledger_outcome?: string }
export class LiveError extends Error {
  readonly code: string; readonly ledger_outcome?: string;
  constructor(code: string, ledger_outcome?: string) { super(code); this.name = 'LiveError'; this.code = code; this.ledger_outcome = ledger_outcome; }
}
type Row = Record<string, unknown>;
const databaseError = () => new LiveError('database_request_failed');
const DatabaseTimestampSchema = z.string().datetime({ offset: true });
function rulingFromRow(row: Row): RulingEvent {
  const timestamp = DatabaseTimestampSchema.parse(row.created_at), instant = new Date(timestamp);
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/u.exec(timestamp)?.[1] ?? '';
  if (!Number.isFinite(instant.getTime()) || fraction.length > 6) throw new LiveError('invalid_ruling_timestamp');
  // PostgREST emits timestamptz offsets and up to six fractional digits. Keep that
  // precision, with one UTC width so the core's timestamp/id ordering stays chronological.
  return RulingEventSchema.parse({ ...row, created_at: `${instant.toISOString().slice(0, -5)}.${fraction.padEnd(6, '0')}Z` });
}
/** Stable per-owner logical suite identity also closes the concurrent insert race. Body keeps its domain id. */
export function suiteDatabaseId(owner: string, id: string): string {
  const hash = sha256(canonical([owner, id]));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
export function sampleFromRow(row: Row): Sample {
  const sample = makeSample(String(row.run_id), row.side as Side, RecordingLineSchema.parse({ task_id: String(row.task_id), sample: Number(row.sample),
    output: row.normalised ?? null, ...(row.raw != null ? { raw: row.raw } : {}), ...(row.error != null ? { error: String(row.error) } : {}) }));
  if (sample.output_sha256 !== row.output_sha256) throw new LiveError('sample_hash_mismatch');
  return sample;
}
export class SupabaseStore implements Store {
  readonly client: SupabaseClient;
  readonly owner_id: string;
  constructor(client: SupabaseClient, owner_id: string) { this.client = client; this.owner_id = owner_id; }
  private async suiteRow(id: string): Promise<Row | undefined> {
    const { data, error } = await this.client.from('suites').select('*').eq('id', id).eq('owner_id', this.owner_id).maybeSingle();
    if (error) throw databaseError();
    return data as Row | undefined ?? undefined;
  }
  async saveSuite(input: Suite): Promise<void> {
    const suite = SuiteSchema.parse(input), id = suiteDatabaseId(this.owner_id, suite.id), hash = sha256(canonical(suite));
    const prior = await this.suiteRow(id);
    if (prior) { if (prior.sha256 !== hash || canonical(prior.body) !== canonical(suite)) throw new LiveError('suite_immutable_choose_new_id'); return; }
    const { error } = await this.client.from('suites').insert({ id, owner_id: this.owner_id, name: suite.name, body: suite, sha256: hash });
    if (error) { const concurrent = await this.suiteRow(id); if (!concurrent || concurrent.sha256 !== hash || canonical(concurrent.body) !== canonical(suite)) throw databaseError(); }
  }
  async getSuite(id: string): Promise<Suite | undefined> {
    const row = await this.suiteRow(suiteDatabaseId(this.owner_id, id));
    return row ? this.validateSuite(row) : undefined;
  }
  private validateSuite(row: Row): Suite {
    const suite = SuiteSchema.parse(row.body);
    if (row.owner_id !== this.owner_id || row.sha256 !== sha256(canonical(suite))) throw new LiveError('suite_hash_mismatch');
    return suite;
  }
  async invoke(body: object): Promise<SampleResponse & { run?: Row }> {
    const { data, error } = await this.client.functions.invoke('run-task', { body });
    if (error) {
      // The SDK puts non-2xx JSON in FunctionsHttpError.context; never print provider/server bodies.
      const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
      let payload: unknown;
      try { payload = await context?.json?.(); } catch { /* Transport failure leaves outcome unknown. */ }
      const response = payload as Partial<SampleResponse> | undefined;
      throw new LiveError(typeof response?.error_code === 'string' ? response.error_code : 'transport_outcome_unknown', response?.ledger_outcome);
    }
    if (!data || typeof data.status !== 'string') throw new LiveError('invalid_response');
    if (data.error_code) throw new LiveError(String(data.error_code), data.ledger_outcome);
    return data as SampleResponse & { run?: Row };
  }
  async createRun(input: Suite, inputArgs: RunArgs): Promise<StoredRun> {
    const suite = SuiteSchema.parse(input), args = RunArgsSchema.parse(inputArgs);
    await this.saveSuite(suite);
    const result = await this.invoke({ op: 'create_run', suite_id: suiteDatabaseId(this.owner_id, suite.id),
      old_model_id: args.old_model, new_model_id: args.new_model, k: args.k });
    if (!result.run) throw new LiveError('invalid_response');
    return this.storedRun(result.run);
  }
  private async storedRun(row: Row): Promise<StoredRun> {
    if (row.owner_id !== this.owner_id || row.mode !== 'live') throw new LiveError('not_owner');
    const suiteRow = await this.suiteRow(String(row.suite_id));
    if (!suiteRow) throw new LiveError('not_owner');
    const suite = this.validateSuite(suiteRow), manifest = RunManifestSchema.parse(row.manifest);
    const args = RunArgsSchema.parse({ k: row.k, old_model: row.old_model, new_model: row.new_model });
    if (manifest.run_id !== row.id || manifest.suite_sha256 !== suiteRow.sha256 || row.suite_sha256 !== suiteRow.sha256 ||
      manifest.k !== args.k || manifest.old_model.id !== args.old_model || manifest.new_model.id !== args.new_model || manifest.mode !== 'live') throw new LiveError('run_manifest_mismatch');
    return { id: String(row.id), owner_id: this.owner_id, suite, args, manifest };
  }
  async getRun(id: string): Promise<StoredRun | undefined> {
    const { data, error } = await this.client.from('runs').select('*').eq('id', id).eq('owner_id', this.owner_id).maybeSingle();
    if (error) throw databaseError();
    return data ? this.storedRun(data as Row) : undefined;
  }
  async addSample(sample: Sample): Promise<void> { void sample; throw new LiveError('samples_are_server_only'); }
  private async ownRows(table: 'samples' | 'rulings' | 'call_attempts', columns: string, run_id?: string): Promise<Row[]> {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = this.client.from(table).select(columns).eq('owner_id', this.owner_id).order('id').range(offset, offset + 999);
      if (run_id) query = query.eq('run_id', run_id);
      const { data, error } = await query;
      if (error || !data) throw databaseError();
      rows.push(...data as Row[]);
      if (data.length < 1000) return rows;
    }
  }
  async listSamples(run_id: string): Promise<Sample[]> {
    return (await this.ownRows('samples', '*', run_id)).map(sampleFromRow);
  }
  async addRuling(input: RulingEvent): Promise<void> {
    const event = RulingEventSchema.parse(input);
    if (event.owner_id !== this.owner_id || !await this.getRun(event.run_id)) throw new LiveError('not_owner');
    replayRulings(this.owner_id, [event.finding_id], [...await this.listRulings(), rulingFromRow(event)]);
    const { error } = await this.client.from('rulings').insert(event);
    if (error) throw databaseError();
  }
  async listRulings(): Promise<RulingEvent[]> {
    return (await this.ownRows('rulings', '*')).map(rulingFromRow).sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  async setCap(cap: number | null): Promise<void> {
    if (cap !== null && (!Number.isFinite(cap) || cap < 0)) throw new LiveError('invalid_cap');
    const { error } = await this.client.rpc('set_my_cap', { p_cap_usd: cap });
    if (error) throw databaseError();
  }
  async budget(): Promise<Budget | null> {
    const { data, error } = await this.client.from('budgets').select('cap_usd,reserved_usd,spent_usd,live_blocked,blocked_reason').eq('owner_id', this.owner_id).maybeSingle();
    if (error) throw databaseError();
    if (!data) return null;
    return { cap_usd: data.cap_usd === null ? null : Number(data.cap_usd), reserved_usd: Number(data.reserved_usd), spent_usd: Number(data.spent_usd),
      live_blocked: Boolean(data.live_blocked), blocked_reason: data.blocked_reason };
  }
  async attempts(run_id?: string): Promise<Attempt[]> {
    return (await this.ownRows('call_attempts', 'id,task_id,side,sample,status,reserve_usd', run_id)).map((row) => ({
      id: String(row.id), task_id: String(row.task_id), side: row.side as Side, sample: Number(row.sample), status: String(row.status), reserve_usd: Number(row.reserve_usd),
    }));
  }
  sample(request: SampleRequest): Promise<SampleResponse> { return this.invoke(request); }
}
