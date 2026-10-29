import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCompareArgs, COMPARE_HELP } from './args.ts';
import { compare } from '../src/core/regressdiff/compare.ts';
import { SuiteSchema } from '../src/core/regressdiff/schema/suite.ts';
import { makeSample, type Side } from '../src/core/regressdiff/pairing.ts';
import { parseRecordings } from '../src/lib/recordings.ts';
import { renderJson } from '../src/core/regressdiff/report/json.ts';
import { renderMarkdown } from '../src/core/regressdiff/report/markdown.ts';

export interface CompareIO {
  readText(path: string): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
}
const nodeIO: CompareIO = { readText: (path) => readFile(path, 'utf8'), stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); } };

/** Imported by tests without dispatching a command; IO is the only host boundary. */
export async function main(argv: readonly string[], io: CompareIO = nodeIO): Promise<0 | 1 | 2> {
  try {
    const args = parseCompareArgs(argv);
    if (args.help) { io.stdout(COMPARE_HELP); return 0; }
    const [suiteText, oldText, newText, policyText] = await Promise.all([
      io.readText(args.suite), io.readText(args.old), io.readText(args.new), io.readText(args.policy),
    ]);
    const suite = SuiteSchema.parse(JSON.parse(suiteText)), policy: unknown = JSON.parse(policyText);
    const run_id = 'cli-compare', taskIds = new Set(suite.tasks.map((task) => task.id));
    const samples = (['old', 'new'] as const).flatMap((side: Side) => {
      const lines = parseRecordings(side === 'old' ? oldText : newText);
      if (lines.some((line) => !taskIds.has(line.task_id))) throw new Error(`${side} recordings contain a task outside the suite`);
      return lines.filter((line) => line.sample <= args.k).map((line) => makeSample(run_id, side, line));
    });
    const comparison = compare({ suite, samples, run_id, owner_id: 'cli-session',
      args: { k: args.k, old_model: 'mock:old', new_model: 'mock:new' }, policy });
    io.stdout(`${args.format === 'json' ? renderJson(comparison.report) : renderMarkdown(comparison.report)}\n`);
    if (comparison.decision.error_kind === 'could_not_judge') {
      io.stderr(`could_not_judge: unresolved recorded evidence; verdict ${comparison.decision.verdict}; ${comparison.decision.rules.join(', ')}\n`);
    }
    return comparison.decision.exit_code;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Invalid comparison input';
    io.stdout(`${JSON.stringify({ schema_version: 'migration-error-v1', error_kind: 'invalid_input', exit_code: 2, errors: [message] }, null, 2)}\n`);
    io.stderr(`invalid_input: ${message}\n`);
    return 2;
  }
}

// A module import never starts comparison, reads a file, or changes the caller's exit code.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
