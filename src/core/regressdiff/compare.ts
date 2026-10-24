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
import { attachEvidence, findingsFromCells, type Cell, type EvidenceFinding } from './findings.ts';
import { replayRulings, type RulingEvent } from './rulings.ts';
import { sortFindings } from './sort.ts';
import { calculateSuiteStatistics, type SuiteStatistics } from './stats/index.ts';
import { evaluatePolicy, type PolicyDecision } from './policy.ts';
import { createReport, type MigrationReport } from './report/json.ts';
import defaultPolicy from '../../../fixtures/policy.json';
import { PolicySchema } from './schema/policy.ts';
import { semanticReviews, type SemanticReview } from './semantic/slot.ts';

export interface CompareInput { suite: unknown; samples: readonly Sample[]; run_id: string; args: RunArgs; owner_id: string; rulings?: readonly RulingEvent[]; manifest?: RunManifest; policy?: unknown }
export interface Comparison { suite: Suite; manifest: RunManifest; cells: Cell[]; findings: EvidenceFinding[]; semantic_reviews: SemanticReview[]; orphaned_rulings: RulingEvent[]; ruling_audit: RulingEvent[]; stats: SuiteStatistics; decision: PolicyDecision; report: MigrationReport }
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
  const policy = PolicySchema.parse(input.policy ?? defaultPolicy);
  const manifest = input.manifest ? RunManifestSchema.parse(input.manifest) : createManifest(suite, input.run_id, args);
  if (manifest.run_id !== input.run_id || manifest.k !== args.k || manifest.old_model.id !== args.old_model || manifest.new_model.id !== args.new_model ||
    manifest.suite_sha256 !== sha256(canonical(suite)) || manifest.normalisation_version !== NORMALISATION_VERSION ||
    manifest.canonical_version !== CANONICAL_VERSION || manifest.verdict_rule_version !== VERDICT_RULE_VERSION) throw new Error('Manifest does not match requested comparison/engine');
  const cells: Cell[] = [];
  const pairs = pairSamples(suite, input.samples, input.run_id, args.k);
  for (const pair of pairs) for (const check of pair.task.checks) {
    const evaluate = (side: 'old' | 'new') => pair.samples.map((item) => {
      const sample = item[side], model = side === 'old' ? manifest.old_model : manifest.new_model;
      return { sample, result: sample.output ? runCheck(check, sample.output, { check_prices: model.check_prices ?? model.prices }) : recordedError(sample) };
    });
    const old_results = evaluate('old'), new_results = evaluate('new');
    cells.push({ task_id: pair.task.id, check_id: check.id, check_type: check.type, check, old_results, new_results,
      ...cellVerdict(old_results.map(({ result }) => result.status), new_results.map(({ result }) => result.status), args.k) });
  }
  // Even an UNCHANGED noisy cell can carry a new-side always-blocking hazard (B2).
  const base = findingsFromCells(cells, true).filter((finding) => finding.verdict !== 'UNCHANGED' ||
    (policy.always_blocking.includes(finding.check_type) && finding.cell.new_counts.fail > 0 &&
      finding.cell.old_counts.pass * 2 > finding.cell.old_counts.pass + finding.cell.old_counts.fail));
  const semanticBase = semanticReviews(pairs);
  const replay = replayRulings(input.owner_id, [...base.map((finding) => finding.id), ...semanticBase.map((item) => item.id)], input.rulings ?? []);
  const semantic_reviews = semanticBase.map((item) => ({ ...item, current_ruling: replay.effective[item.id] ?? null }));
  const evidenced = base.map((finding) => attachEvidence({ ...finding, current_ruling: replay.effective[finding.id] ?? null }));
  const stats = calculateSuiteStatistics({ suite, manifest, cells });
  const decision = evaluatePolicy({ policy, manifest, cells, findings: evidenced, semantic_reviews });
  const blockCausing = new Set(decision.block_causing_ids);
  // Waivers change effective policy/badges, while ranking retains the unwaived blocking priority.
  const orderingBlockCausing = new Set(evaluatePolicy({ policy, manifest, cells,
    findings: evidenced.map((finding) => ({ ...finding, current_ruling: null })) }).block_causing_ids);
  const findings = sortFindings(evidenced.map((finding) => ({ ...finding, block_causing: blockCausing.has(finding.id) })), decision.raw_policy.always_blocking, orderingBlockCausing);
  const report = createReport({ manifest, stats, decision, findings, cells, semantic_reviews, orphaned_rulings: replay.orphaned, ruling_audit: replay.audit });
  return { suite, manifest, cells, findings, semantic_reviews, stats, decision, report, orphaned_rulings: replay.orphaned, ruling_audit: replay.audit };
}
