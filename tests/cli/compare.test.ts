import { describe, expect, it } from 'vitest';
import { main, type CompareIO } from '../../cli/compare.ts';

const suite = { id: 'cli-suite', name: 'CLI contract', tasks: [{ id: 'task', category: 'format',
  messages: [{ role: 'user', content: 'Start with OK' }], tools: [], independent_tool_calls: false,
  checks: [{ id: 'prefix', type: 'starts_with', params: { value: 'OK', field: 'text' } }] }] };
const policy = { max_regressions: 0, always_blocking: ['tool_forbidden', 'tool_order'], cost_cap: { per_task_median: null, suite_total: null },
  latency_cap: { per_task_median: null, suite_total: null }, allow_waive_blocking: false, block_preexisting_hazards: false };
const recording = (text: string) => JSON.stringify({ task_id: 'task', sample: 1, output: { text, thinking: '', tool_calls: [],
  tool_calls_original: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, latency_ms: 10 } });
function fakeIO(newText = recording('OK'), overrides: Record<string, string> = {}) {
  const files: Record<string, string> = { 'fixtures/suite.demo.json': JSON.stringify(suite), 'fixtures/recordings/old.jsonl': recording('OK'),
    'fixtures/recordings/new.jsonl': newText, 'fixtures/policy.json': JSON.stringify(policy), ...overrides };
  const stdout: string[] = [], stderr: string[] = [], reads: string[] = [];
  const io: CompareIO = { readText: async (path) => { reads.push(path); if (!(path in files)) throw new Error(`File unavailable: ${path}`); return files[path]; },
    stdout: (text) => { stdout.push(text); }, stderr: (text) => { stderr.push(text); } };
  return { io, stdout, stderr, reads };
}
describe('CLI shares the deterministic comparison and report path', () => {
  it('returns 0 for judged safe output', async () => {
    const fake = fakeIO(); expect(await main([], fake.io)).toBe(0);
    expect(JSON.parse(fake.stdout.join('')).decision.verdict).toBe('SAFE_WITH_NOTES'); expect(fake.stderr).toEqual([]);
  });
  it('returns 1 for BLOCK and prints the named policy rule', async () => {
    const fake = fakeIO(recording('bad')); expect(await main([], fake.io)).toBe(1);
    expect(JSON.parse(fake.stdout.join('')).decision).toMatchObject({ verdict: 'BLOCK', exit_code: 1 });
    expect(JSON.parse(fake.stdout.join('')).decision.rules.join(' ')).toContain('B3');
  });
  it('returns 0 for REVIEW when judged regressions fit the permitted maximum', async () => {
    const fake = fakeIO(recording('bad'), { 'fixtures/policy.json': JSON.stringify({ ...policy, max_regressions: 1 }) });
    expect(await main([], fake.io)).toBe(0); expect(JSON.parse(fake.stdout.join('')).decision.verdict).toBe('REVIEW');
  });
  it('distinguishes missing recorded evidence from invalid input in JSON and stderr', async () => {
    const fake = fakeIO(''); expect(await main([], fake.io)).toBe(2);
    expect(JSON.parse(fake.stdout.join('')).decision.error_kind).toBe('could_not_judge');
    expect(fake.stderr.join('')).toMatch(/^could_not_judge:/u); expect(fake.stderr.join('')).not.toContain('invalid_input');
  });
  it('keeps a recorded provider error as could_not_judge', async () => {
    const fake = fakeIO(JSON.stringify({ task_id: 'task', sample: 1, output: null, error: 'recorded_timeout' }));
    expect(await main([], fake.io)).toBe(2); expect(JSON.parse(fake.stdout.join('')).decision.error_kind).toBe('could_not_judge');
  });
  const malformedInputs: Array<Record<string, string>> = [{ 'fixtures/suite.demo.json': '{bad' }, { 'fixtures/policy.json': '{"unknown":true}' },
    { 'fixtures/recordings/new.jsonl': '{bad' }, { 'fixtures/recordings/new.jsonl': `${recording('OK')}\n${recording('OK')}` }];
  for (const overrides of malformedInputs) {
    it('returns invalid_input JSON and a distinct stderr line for malformed input', async () => {
      const fake = fakeIO(recording('OK'), overrides); expect(await main([], fake.io)).toBe(2);
      expect(JSON.parse(fake.stdout.join(''))).toMatchObject({ error_kind: 'invalid_input', exit_code: 2 });
      expect(fake.stderr.join('')).toMatch(/^invalid_input:/u);
    });
  }
  it('invalid flags fail before file IO and even Markdown mode emits machine-readable errors', async () => {
    const fake = fakeIO(); expect(await main(['--format', 'markdown', '--k', '2'], fake.io)).toBe(2);
    expect(fake.reads).toEqual([]); expect(JSON.parse(fake.stdout.join('')).error_kind).toBe('invalid_input');
  });
  it('help performs no input reads', async () => {
    const fake = fakeIO(); expect(await main(['--help'], fake.io)).toBe(0); expect(fake.reads).toEqual([]);
  });
  it('exports Markdown from the same report without an alternative judgment path', async () => {
    const fake = fakeIO(); expect(await main(['--format', 'markdown'], fake.io)).toBe(0);
    expect(fake.stdout.join('')).toContain('SAFE_WITH_NOTES'); expect(fake.stdout.join('')).toContain('Raw and effective policy');
  });
});
