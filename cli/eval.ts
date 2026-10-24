import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, CANONICAL_VERSION } from '../src/core/regressdiff/canonical.ts';
import { sha256 } from '../src/core/regressdiff/hash.ts';
import { NORMALISATION_VERSION } from '../src/core/regressdiff/normalise.ts';
import { VERDICT_RULE_VERSION } from '../src/core/regressdiff/verdict.ts';
import { createManifest } from '../src/core/regressdiff/compare.ts';
import { SuiteSchema } from '../src/core/regressdiff/schema/suite.ts';
import { buildBenchmark } from '../src/core/regressdiff/benchmark/manifest.ts';
import { METHOD_IDS, METHOD_VERSION, runMethods } from '../src/core/regressdiff/benchmark/methods.ts';
import { calculateMetrics, proposalLines, renderResults, type BenchmarkReport } from '../src/core/regressdiff/benchmark/metrics.ts';
import { classSupport, renderSupport } from '../src/core/regressdiff/benchmark/support.ts';
import { parseRecordings } from '../src/lib/recordings.ts';
import policy from '../fixtures/policy.json';

export const GENERATED_START = '<!-- benchmark-results:start -->';
export const GENERATED_END = '<!-- benchmark-results:end -->';
export interface EvalArgs { suite: string; old: string; out: string; seed: number; heldout: boolean; help: boolean }
export const EVAL_HELP = `Usage: npm run eval -- [--heldout] [--suite PATH] [--old PATH] [--out DIR] [--seed INTEGER]
Default: dev, fixtures/suite.demo.json, fixtures/recordings/old.jsonl, results/, seed 40.
Recorded synthetic benchmark: k=1/5, all five methods. No provider/network calls.
Held-out reserves version/config before evaluation; a failed attempt cannot repeat.
`;
export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  const args: EvalArgs = { suite: 'fixtures/suite.demo.json', old: 'fixtures/recordings/old.jsonl', out: 'results', seed: 40, heldout: false, help: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (seen.has(token)) throw new Error(`Duplicate argument: ${token}`);
    seen.add(token);
    if (token === '--heldout') { args.heldout = true; continue; }
    if (!['--suite', '--old', '--out', '--seed'].includes(token)) throw new Error(`Unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    if (token === '--seed') {
      if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 0xffffffff) throw new Error('--seed must be an unsigned 32-bit integer');
      args.seed = Number(value);
    } else if (token === '--suite') args.suite = value;
    else if (token === '--old') args.old = value;
    else args.out = value;
  }
  return args;
}
export interface HeldoutEvent { benchmark_version: string; config_sha256: string; key: string; status: 'started' | 'completed' | 'failed'; at: string; detail?: string }
/** Any prior event, including started/failed, consumes this frozen configuration. */
export function assertHeldoutUnused(log: string, key: string): void {
  for (const line of log.split(/\r?\n/u).filter((item) => item.trim())) {
    let event: unknown;
    try { event = JSON.parse(line); } catch { throw new Error('Malformed held-out log; refusing evaluation'); }
    if (!event || typeof event !== 'object' || !('key' in event) || typeof event.key !== 'string' || !('status' in event) || !['started', 'completed', 'failed'].includes(String(event.status))) throw new Error('Invalid held-out log entry; refusing evaluation');
    if (event.key === key) throw new Error('Held-out benchmark version/config already attempted; refusing repeated evaluation');
  }
}
export interface EvalIO {
  readText(path: string): Promise<string>; readOptional(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>; ensureDirectory(path: string): Promise<void>;
  reserveHeldout(path: string, event: HeldoutEvent): Promise<void>; appendHeldout(path: string, event: HeldoutEvent): Promise<void>;
  now(): string; stdout(text: string): void; stderr(text: string): void;
}
async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
const nodeIO: EvalIO = {
  readText: (path) => readFile(path, 'utf8'), readOptional, writeText: (path, text) => writeFile(path, text, 'utf8'),
  ensureDirectory: async (path) => { await mkdir(path, { recursive: true }); },
  reserveHeldout: async (path, event) => {
    assertHeldoutUnused(await readOptional(path) ?? '', event.key);
    // Persistent exclusive reservation closes a same-config race; retain even after crash/failure.
    const reservation = await open(`${path}.${event.key}.reservation`, 'wx');
    try { await reservation.writeFile(`${JSON.stringify(event)}\n`, 'utf8'); } finally { await reservation.close(); }
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');
  },
  appendHeldout: (path, event) => appendFile(path, `${JSON.stringify(event)}\n`, 'utf8'), now: () => new Date().toISOString(),
  stdout: (text) => { process.stdout.write(text); }, stderr: (text) => { process.stderr.write(text); },
};
/** Replace one existing generated block, leaving authored prose untouched. */
export function updateGeneratedBlock(text: string, generated: string): string {
  const start = text.indexOf(GENERATED_START), end = text.indexOf(GENERATED_END);
  if (start < 0 || end <= start || text.indexOf(GENERATED_START, start + GENERATED_START.length) >= 0 || text.indexOf(GENERATED_END, end + GENERATED_END.length) >= 0) throw new Error('README must have exactly one ordered benchmark generated marker pair');
  return `${text.slice(0, start + GENERATED_START.length)}\n\n${generated.trim()}\n\n${text.slice(end)}`;
}
export async function main(argv: readonly string[], io: EvalIO = nodeIO): Promise<0 | 2> {
  let reservation: { path: string; event: HeldoutEvent } | null = null;
  try {
    const args = parseEvalArgs(argv);
    if (args.help) { io.stdout(EVAL_HELP); return 0; }
    const [suiteText, oldText] = await Promise.all([io.readText(args.suite), io.readText(args.old)]);
    const suite = SuiteSchema.parse(JSON.parse(suiteText));
    const benchmark = buildBenchmark(suite, parseRecordings(oldText), { seed: args.seed });
    const partition = args.heldout ? 'heldout' as const : 'dev' as const, support = classSupport(benchmark.variants);
    // Print the full frozen inventory before executing any method/calculating any metric.
    io.stdout(`${renderSupport(support, partition)}\n`);
    const config_sha256 = sha256(canonical({ manifest: benchmark.manifest, methods: METHOD_IDS, methods_version: METHOD_VERSION, k: [1, 5],
      normalisation: NORMALISATION_VERSION, canonical: CANONICAL_VERSION, verdict: VERDICT_RULE_VERSION,
      models: createManifest(suite, 'benchmark-config', { k: 5, old_model: 'mock:old', new_model: 'mock:new' }), policy }));
    const benchmark_version = benchmark.manifest.version;
    await io.ensureDirectory(args.out);
    if (args.heldout) {
      const event: HeldoutEvent = { benchmark_version, config_sha256, key: sha256(canonical({ benchmark_version, config_sha256 })), status: 'started', at: io.now() };
      // --out cannot bypass the canonical held-out guard.
      await io.ensureDirectory('results');
      await io.reserveHeldout('results/heldout-run.log', event);
      reservation = { path: 'results/heldout-run.log', event };
    }
    const results = runMethods(benchmark.variants.filter((variant) => variant.partition === partition)), metrics = calculateMetrics(results, support);
    const report: BenchmarkReport = { schema_version: 'benchmark-results-v1', partition, benchmark_version, config_sha256, measured_at: io.now(),
      caveat: 'Author-built synthetic plants; descriptive Wilson intervals with variants clustered by base task. No real-world drift or live spend is measured.',
      support, metrics, proposals: proposalLines(metrics, partition), excluded_source_errors: benchmark.manifest.excluded_tasks.map((item) => ({
        task_id: item.task_id, error_samples: item.error_samples, accounting: item.expected_accounting, reason: item.reason })),
      semantic: { key_token: 'pending M6 evaluation', refusal_style: 'pending M6 evaluation', generative_judge: 'not evaluated (disabled)', jev: 'not evaluated (disabled)' } };
    const markdown = renderResults(report);
    await io.writeText(join(args.out, 'results.md'), markdown);
    await io.writeText(join(args.out, 'results.jsonl'), [{ type: 'summary', ...report }, ...results.map((result) => ({ type: 'variant', ...result }))].map((row) => JSON.stringify(row)).join('\n') + '\n');
    await io.writeText(join(args.out, 'manifest.json'), `${JSON.stringify(benchmark.manifest, null, 2)}\n`);
    for (const path of [join(args.out, 'README.md'), 'README.md']) {
      const readme = await io.readOptional(path);
      if (readme !== null) await io.writeText(path, updateGeneratedBlock(readme, markdown));
    }
    if (reservation) await io.appendHeldout(reservation.path, { ...reservation.event, status: 'completed', at: io.now() });
    io.stdout(`${markdown}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Evaluation failed';
    if (reservation) {
      try { await io.appendHeldout(reservation.path, { ...reservation.event, status: 'failed', at: io.now(), detail: message }); }
      catch { io.stderr('heldout_log_error: reservation retained; do not retry this held-out configuration\n'); }
    }
    io.stderr(`eval_error: ${message}\n`); return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
