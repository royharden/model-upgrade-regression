import { CHECK_TYPES, type CheckType } from '../checks/index.ts';
import { measuredCost } from '../checks/cost_budget.ts';
import type { Cell } from '../findings.ts';
import type { Sample } from '../pairing.ts';
import type { Suite } from '../schema/suite.ts';
import type { RunManifest } from '../schema/manifest.ts';
import { benjaminiHochberg, type AdjustedP } from './bh.ts';
import { bootstrapMedianDifference, median, type BootstrapInterval } from './bootstrap.ts';
import { exactMcNemar } from './mcnemar.ts';
import { exactWilcoxon } from './wilcoxon.ts';

export { mulberry32 } from './prng.ts';
export { exactMcNemar } from './mcnemar.ts';
export { exactWilcoxon } from './wilcoxon.ts';
export { bootstrapMedianDifference, median, BOOTSTRAP_ITERATIONS } from './bootstrap.ts';
export { benjaminiHochberg } from './bh.ts';
export { wilsonInterval } from './wilson.ts';
export type { BootstrapInterval } from './bootstrap.ts';

export type StatisticStatus = 'ok' | 'not_applicable' | 'insufficient';
interface StatisticLine extends AdjustedP {
  id: string; method: string; status: StatisticStatus; n: number;
}
export interface McNemarStatistic extends StatisticLine {
  check_type: CheckType; b: number; c: number; both_pass: number; both_fail: number;
  excluded_could_not_judge: number; excluded_missing: number;
}
export type ContinuousMetric = 'answer_length' | 'cost_usd' | 'latency_ms';
export interface ContinuousStatistic extends StatisticLine {
  metric: ContinuousMetric; unit: 'code points' | 'USD' | 'ms'; task_pairs: number; excluded_tasks: number;
  excluded_unknown_usage: number; excluded_unknown_metric: number; excluded_missing_output: number;
  zero_differences: number; w_plus: number; w_minus: number; median_difference: number | null;
  bootstrap: BootstrapInterval | null;
}
export type SuiteStatistic = McNemarStatistic | ContinuousStatistic;
export interface SuiteStatistics {
  diagnostic_only: true; preregistered_tests: 21; seed: number;
  correction: { method: 'Benjamini-Hochberg'; q: number; denominator: number };
  tests: SuiteStatistic[]; mcnemar: McNemarStatistic[]; continuous: ContinuousStatistic[]; cost_label: string;
}
export interface SuiteStatisticsInput { suite: Suite; manifest: RunManifest; cells: readonly Cell[] }

function samplesForTask(cells: readonly Cell[], side: 'old' | 'new', k: number): Sample[] | null {
  const first = cells[0];
  if (!first) return null;
  const samples = first[side === 'old' ? 'old_results' : 'new_results'].map(({ sample }) => sample);
  if (samples.length !== k || new Set(samples.map((sample) => sample.sample)).size !== k ||
    samples.some((sample) => sample.sample < 1 || sample.sample > k)) return null;
  return [...samples].sort((a, b) => a.sample - b.sample);
}

/** Diagnostics are derived from original checks/samples, never written back to cells or rulings. */
export function calculateSuiteStatistics({ suite, manifest, cells }: SuiteStatisticsInput): SuiteStatistics {
  const byTask = new Map<string, Cell[]>();
  for (const cell of cells) {
    const taskCells = byTask.get(cell.task_id) ?? [];
    taskCells.push(cell);
    byTask.set(cell.task_id, taskCells);
  }
  const mcnemar: McNemarStatistic[] = CHECK_TYPES.map((check_type) => {
    let b = 0, c = 0, both_pass = 0, both_fail = 0, excluded_could_not_judge = 0, excluded_missing = 0;
    for (const task of suite.tasks) {
      const expected = task.checks.filter((check) => check.type === check_type);
      if (!expected.length) continue;
      const taskCells = byTask.get(task.id) ?? [];
      const family = expected.map((check) => taskCells.find((cell) => cell.check_id === check.id && cell.check_type === check_type));
      if (family.some((cell) => !cell)) { excluded_missing++; continue; }
      const complete = family as Cell[];
      if (complete.some((cell) => cell.verdict === 'COULD_NOT_JUDGE' ||
        cell.old_results.some(({ result }) => result.status === 'error') || cell.new_results.some(({ result }) => result.status === 'error'))) {
        excluded_could_not_judge++; continue;
      }
      if (complete.some((cell) => cell.old_results.length !== manifest.k || cell.new_results.length !== manifest.k)) {
        excluded_missing++; continue;
      }
      // One task-family observation, with a conjunction across checks; no pseudo-replicated samples/checks.
      const passes = (side: 'old_results' | 'new_results') => complete.every((cell) =>
        cell[side].filter(({ result }) => result.status === 'pass').length > manifest.k / 2);
      const old = passes('old_results'), next = passes('new_results');
      if (old && next) both_pass++;
      else if (old) b++;
      else if (next) c++;
      else both_fail++;
    }
    const n = b + c + both_pass + both_fail;
    return { id: `mcnemar:${check_type}`, check_type, method: 'exact two-sided McNemar', status: n ? 'ok' : 'not_applicable',
      n, b, c, both_pass, both_fail, excluded_could_not_judge, excluded_missing,
      raw_p: n ? exactMcNemar(b, c) : null, adjusted_p: null, significant: null };
  });
  const metrics = [
    { metric: 'answer_length', unit: 'code points' }, { metric: 'cost_usd', unit: 'USD' }, { metric: 'latency_ms', unit: 'ms' },
  ] as const;
  const continuous: ContinuousStatistic[] = metrics.map(({ metric, unit }) => {
    const differences: number[] = [];
    let excluded_unknown_usage = 0, excluded_unknown_metric = 0, excluded_missing_output = 0;
    for (const task of suite.tasks) {
      const taskCells = byTask.get(task.id) ?? [], old = samplesForTask(taskCells, 'old', manifest.k), next = samplesForTask(taskCells, 'new', manifest.k);
      if (!old || !next || [...old, ...next].some((sample) => sample.output === null)) { excluded_missing_output++; continue; }
      if (metric === 'cost_usd' && [...old, ...next].some((sample) => sample.output?.usage == null)) {
        excluded_unknown_usage++; continue;
      }
      const measure = (samples: readonly Sample[], side: 'old' | 'new'): (number | null)[] => samples.map(({ output }) => {
        if (!output) return null;
        if (metric === 'answer_length') return Array.from(output.text).length;
        if (metric === 'latency_ms') return output.latency_ms;
        const model = side === 'old' ? manifest.old_model : manifest.new_model;
        return measuredCost(output, model.check_prices ?? model.prices);
      });
      const oldValues = measure(old, 'old'), newValues = measure(next, 'new');
      // Unknown values exclude the task pair; do not shrink a side's sample denominator.
      if ([...oldValues, ...newValues].some((value) => value === null || !Number.isFinite(value))) { excluded_unknown_metric++; continue; }
      differences.push(median(newValues as number[]) - median(oldValues as number[]));
    }
    const signedRank = exactWilcoxon(differences);
    return { id: `wilcoxon:${metric}`, metric, unit, method: signedRank.method,
      status: differences.length ? signedRank.status : 'not_applicable', n: signedRank.n, task_pairs: differences.length,
      excluded_tasks: suite.tasks.length - differences.length, excluded_unknown_usage, excluded_unknown_metric, excluded_missing_output,
      zero_differences: signedRank.zero_differences, w_plus: signedRank.w_plus, w_minus: signedRank.w_minus,
      median_difference: differences.length ? median(differences) : null,
      bootstrap: bootstrapMedianDifference(differences, manifest.seed), raw_p: signedRank.raw_p, adjusted_p: null, significant: null };
  });
  const tests: SuiteStatistic[] = [...mcnemar, ...continuous];
  const corrected = benjaminiHochberg(tests.map((test) => test.raw_p));
  tests.forEach((test, i) => Object.assign(test, corrected.tests[i]));
  const synthetic = (manifest.old_model.check_prices ?? manifest.old_model.prices)?.synthetic ||
    (manifest.new_model.check_prices ?? manifest.new_model.prices)?.synthetic;
  return { diagnostic_only: true, preregistered_tests: 21, seed: manifest.seed,
    correction: { method: corrected.method, q: corrected.q, denominator: corrected.denominator }, tests, mcnemar, continuous,
    cost_label: synthetic ? 'USD: synthetic check price, not spend' : 'USD: verified check price; unknown usage/prices excluded' };
}
