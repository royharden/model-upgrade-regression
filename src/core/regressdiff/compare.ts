import modelsJson from '../../../supabase/functions/run-task/portable/models.json';
import { canonical, CANONICAL_VERSION } from './canonical.ts';
import { sha256 } from './hash.ts';
import { NORMALISATION_VERSION } from './normalise.ts';
import { SuiteSchema, type Suite } from './schema/suite.ts';
import { ModelsSchema } from './schema/models.ts';
import { RunArgsSchema, RunManifestSchema, type RunArgs, type RunManifest } from './schema/manifest.ts';
import { runCheck } from './checks/index.ts';
import type { CheckResult } from './evidence.ts';
import { pairSamples, type Sample } from './pairing.ts';
import { cellVerdict, VERDICT_RULE_VERSION } from './verdict.ts';
import { findingsFromCells, type Cell, type Finding } from './findings.ts';
import { replayRulings, type RulingEvent } from './rulings.ts';
import { sortFindings } from './sort.ts';

export interface CompareInput { suite: unknown; samples: readonly Sample[]; run_id: string; args: RunArgs; owner_id: string; rulings?: readonly RulingEvent[]; manifest?: RunManifest }
export interface Comparison { suite: Suite; manifest: RunManifest; cells: Cell[]; findings: Finding[]; orphaned_rulings: RulingEvent[]; ruling_audit: RulingEvent[] }
export function createManifest(suite: Suite, run_id: string, args: RunArgs): RunManifest {
  const config = ModelsSchema.parse(modelsJson);
  const old = config.models.find((model) => model.id === args.old_model), next = config.models.find((model) => model.id === args.new_model);
  if (!old || !next) throw new Error('Model is not allowlisted');
  return RunManifestSchema.parse({ run_id, suite_sha256: sha256(canonical(suite)), models_config_sha256: sha256(canonical(config)),
    k: args.k, mode: old.provider === 'mock' && next.provider === 'mock' ? 'demo' : 'live', old_model: old, new_model: next,
    normalisation_version: NORMALISATION_VERSION, canonical_version: CANONICAL_VERSION, verdict_rule_version: VERDICT_RULE_VERSION, seed: 40 });
}
function recordedError(sample: Sample): CheckResult {
  return { status: 'error', evidence: { field: 'text', anchor: 0, context: '' }, expected: 'recorded output', observed: null, detail: sample.error ?? 'missing_sample' };
}
export function compare(input: CompareInput): Comparison {
  const suite = SuiteSchema.parse(input.suite), args = RunArgsSchema.parse(input.args);
  const manifest = input.manifest ? RunManifestSchema.parse(input.manifest) : createManifest(suite, input.run_id, args);
  if (manifest.run_id !== input.run_id || manifest.k !== args.k || manifest.old_model.id !== args.old_model || manifest.new_model.id !== args.new_model ||
    manifest.suite_sha256 !== sha256(canonical(suite)) || manifest.normalisation_version !== NORMALISATION_VERSION ||
    manifest.canonical_version !== CANONICAL_VERSION || manifest.verdict_rule_version !== VERDICT_RULE_VERSION) throw new Error('Manifest does not match requested comparison/engine');
  const cells: Cell[] = [];
  for (const pair of pairSamples(suite, input.samples, input.run_id, args.k)) for (const check of pair.task.checks) {
    const evaluate = (side: 'old' | 'new') => pair.samples.map((item) => {
      const sample = item[side], model = side === 'old' ? manifest.old_model : manifest.new_model;
      return { sample, result: sample.output ? runCheck(check, sample.output, { check_prices: model.check_prices ?? model.prices }) : recordedError(sample) };
    });
    const old_results = evaluate('old'), new_results = evaluate('new');
    cells.push({ task_id: pair.task.id, check_id: check.id, check_type: check.type, check, old_results, new_results,
      ...cellVerdict(old_results.map(({ result }) => result.status), new_results.map(({ result }) => result.status), args.k) });
  }
  const findings = findingsFromCells(cells), replay = replayRulings(input.owner_id, findings.map((finding) => finding.id), input.rulings ?? []);
  return { suite, manifest, cells, findings: sortFindings(findings.map((finding) => ({ ...finding, current_ruling: replay.effective[finding.id] ?? null }))),
    orphaned_rulings: replay.orphaned, ruling_audit: replay.audit };
}
