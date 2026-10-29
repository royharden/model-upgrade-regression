export interface CompareArgs {
  suite: string; old: string; new: string; policy: string; k: 1 | 3 | 5; format: 'json' | 'markdown'; help: boolean;
}
export const COMPARE_HELP = `Usage: npm run compare -- [options]
  --suite PATH   Suite JSON (default fixtures/suite.demo.json)
  --old PATH     Old recorded JSONL (default fixtures/recordings/old.jsonl)
  --new PATH     New recorded JSONL (default fixtures/recordings/new.jsonl)
  --k 1|3|5      Samples per side (default 1)
  --policy PATH  Policy JSON (default fixtures/policy.json)
  --format json|markdown  Standard output format (default json)
  --help         Show this help
Recorded inputs only. No provider calls. BLOCK exits 1; unresolved uncertainty exits 2; otherwise 0.
REVIEW is printed explicitly and may exit 0. Invalid input always emits JSON with error_kind=invalid_input.
`;
export function parseCompareArgs(argv: readonly string[]): CompareArgs {
  const result: CompareArgs = { suite: 'fixtures/suite.demo.json', old: 'fixtures/recordings/old.jsonl',
    new: 'fixtures/recordings/new.jsonl', policy: 'fixtures/policy.json', k: 1, format: 'json', help: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--help' || token === '-h') { result.help = true; continue; }
    const equal = token.indexOf('='), flag = equal < 0 ? token : token.slice(0, equal);
    if (!['--suite', '--old', '--new', '--policy', '--k', '--format'].includes(flag)) throw new Error(`Unknown argument: ${token}`);
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    const value = equal < 0 ? argv[++index] : token.slice(equal + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--k') {
      if (value !== '1' && value !== '3' && value !== '5') throw new Error('--k must be 1, 3, or 5');
      result.k = Number(value) as 1 | 3 | 5;
    } else if (flag === '--format') {
      if (value !== 'json' && value !== 'markdown') throw new Error('--format must be json or markdown');
      result.format = value;
    } else if (flag === '--suite') result.suite = value;
    else if (flag === '--old') result.old = value;
    else if (flag === '--new') result.new = value;
    else result.policy = value;
  }
  return result;
}
