import { describe, expect, it } from 'vitest';
import { parseCompareArgs } from '../../cli/args.ts';

describe('recorded comparison arguments', () => {
  it('uses the documented fixture defaults with mock CLI k=1', () => {
    expect(parseCompareArgs([])).toEqual({ suite: 'fixtures/suite.demo.json', old: 'fixtures/recordings/old.jsonl',
      new: 'fixtures/recordings/new.jsonl', policy: 'fixtures/policy.json', k: 1, format: 'json', help: false });
  });
  it('accepts explicit recording, suite, policy, k and output flags', () => {
    expect(parseCompareArgs(['--suite', 'suite file.json', '--old', 'old.jsonl', '--new=new.jsonl', '--k', '3', '--policy', 'policy.json', '--format=markdown']))
      .toMatchObject({ suite: 'suite file.json', old: 'old.jsonl', new: 'new.jsonl', k: 3, policy: 'policy.json', format: 'markdown' });
  });
  for (const argv of [['--k', '2'], ['--k', '3.0'], ['--suite'], ['--old', '--new'], ['--k', '3', '--k', '5'], ['--format', 'html'], ['--unknown'], ['stray']]) {
    it(`rejects invalid arguments ${argv.join(' ')}`, () => expect(() => parseCompareArgs(argv)).toThrow());
  }
  it('accepts help without requiring file input', () => expect(parseCompareArgs(['--help']).help).toBe(true));
});
