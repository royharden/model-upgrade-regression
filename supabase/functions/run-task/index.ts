import { createClient } from '@supabase/supabase-js';
import modelsJson from './portable/models.json' with { type: 'json' };
import { handleRunTask, RunTaskError, type RpcResult, type SampleRow, type RunRow, type SuiteRow, type HandlerDeps } from './handler.ts';
import { prepareLiveCall } from './live-call.ts';
import { canonical, CANONICAL_VERSION } from '../../../src/core/regressdiff/canonical.ts';
import { sha256, hashOutput, hashError } from '../../../src/core/regressdiff/hash.ts';
import { normalise, NORMALISATION_VERSION } from '../../../src/core/regressdiff/normalise.ts';
import { VERDICT_RULE_VERSION } from '../../../src/core/regressdiff/verdict.ts';
import { SuiteSchema } from '../../../src/core/regressdiff/schema/suite.ts';
import { ModelsSchema } from '../../../src/core/regressdiff/schema/models.ts';
import { RunManifestSchema } from '../../../src/core/regressdiff/schema/manifest.ts';

/** Deployment entry only: service credentials never enter a browser or portable module. */
const env = (name: string): string | undefined => Deno.env.get(name);
const required = (name: string): string => { const value = env(name); if (!value) throw new RunTaskError('missing_secret', [name]); return value; };
Deno.serve(async (request: Request): Promise<Response> => {
  // Construct privileged clients lazily: even OPTIONS and missing-config paths get the handler's CORS response.
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const service = () => createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), clientOptions);
  const deps: HandlerDeps = {
    allowedOrigins: (env('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    models: ModelsSchema.parse(modelsJson),
    authenticate: async (incoming) => {
      const authorization = incoming.headers.get('Authorization');
      if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return null;
      const client = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), { ...clientOptions, global: { headers: { Authorization: authorization } } });
      const { data, error } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
      if (error || !data.user) return null;
      return { id: data.user.id, reader: {
        suite: async (suiteId) => { const result = await client.from('suites').select('id,owner_id,body,sha256').eq('id', suiteId).maybeSingle(); if (result.error) throw new RunTaskError('provider_error'); return result.data as SuiteRow | null; },
        run: async (runId) => { const result = await client.from('runs').select('*').eq('id', runId).maybeSingle(); if (result.error) throw new RunTaskError('provider_error'); return result.data as RunRow | null; },
      } };
    },
    rpc: async (name, args) => {
      const { data, error } = await service().rpc(name, args);
      if (error) throw new RunTaskError(error.message);
      return data as RpcResult;
    },
    insertSample: async (sample) => {
      const { data, error } = await service().from('samples').insert(sample).select('*').single();
      if (error) throw new RunTaskError('provider_error');
      return data as SampleRow;
    },
    parseSuite: (value) => { const result = SuiteSchema.safeParse(value); if (!result.success) throw new RunTaskError('invalid_input'); return result.data; },
    parseManifest: (value) => { const result = RunManifestSchema.safeParse(value); if (!result.success) throw new RunTaskError('invalid_input'); return result.data; },
    canonical, sha256, normalise, hashOutput, hashError, uuid: () => crypto.randomUUID(),
    versions: { normalisation: NORMALISATION_VERSION, canonical: CANONICAL_VERSION, verdict: VERDICT_RULE_VERSION },
    prepareCall: (model, body) => prepareLiveCall(model, body, env),
  };
  return handleRunTask(request, deps);
});
