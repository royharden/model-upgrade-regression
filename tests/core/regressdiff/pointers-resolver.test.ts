import { describe, expect, it } from 'vitest';
import { makeSample } from '../../../src/core/regressdiff/pairing.ts';
import { normalise } from '../../../src/core/regressdiff/normalise.ts';
import { spanEvidence, anchorEvidence, fieldView, type EvidenceField } from '../../../src/core/regressdiff/evidence.ts';
import { createPointer, parsePointer, formatPointer } from '../../../src/core/regressdiff/pointers.ts';
import { resolvePointer } from '../../../src/core/regressdiff/resolver.ts';
import { diffField } from '../../../src/core/regressdiff/diff.ts';

const output = normalise({ text: 'A😀B\nanswer', thinking: 'hidden', tool_calls: [{ name: 'lookup', args: { z: 2, a: 1 } }],
  stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 }, latency_ms: 123 }, { independent_tool_calls: false });
const sample = makeSample('run.1', 'new', { task_id: 'task-1', sample: 1, output });

describe('canonical evidence pointers', () => {
  it('uses Unicode code points and the optional field segment preserves the exact spec form', () => {
    const pointer = createPointer(sample, spanEvidence(output, 'text', 1, 2));
    expect(pointer.quote).toBe('😀');
    expect(pointer.pointer).toBe('run:run.1/task:task-1/side:new/sample:1/field:text#1-2');
    const bare = { ...pointer, pointer: formatPointer(parsePointer(pointer.pointer), true) };
    expect(bare.pointer).toBe('run:run.1/task:task-1/side:new/sample:1#1-2');
    expect(resolvePointer(bare, [sample])).toMatchObject({ status: 'supported', quote: '😀' });
  });
  it.each(['tool_calls', 'tool_calls_original', 'thinking', 'stop_reason', 'usage', 'latency_ms'] as EvidenceField[])('resolves %s against its field view', (field) => {
    const pointer = createPointer(sample, spanEvidence(output, field));
    expect(resolvePointer(pointer, [sample])).toMatchObject({ status: 'supported', view: fieldView(output, field) });
  });
  it('supports an empty answer, a tool-only output, and a deletion anchor at the end', () => {
    const empty = { ...output, text: '' }, emptySample = makeSample('run.1', 'old', { task_id: 'task-1', sample: 1, output: empty });
    expect(resolvePointer(createPointer(emptySample, anchorEvidence(empty, 'text')), [emptySample])).toMatchObject({ status: 'supported', quote: '' });
    expect(resolvePointer(createPointer(emptySample, spanEvidence(empty, 'tool_calls')), [emptySample]).status).toBe('supported');
    const deletion = createPointer(sample, anchorEvidence(output, 'text', Array.from(output.text).length));
    expect(resolvePointer(deletion, [sample]).status).toBe('supported');
    expect(resolvePointer({ ...deletion, context: 'invented' }, [sample]).reason).toBe('anchor_context_mismatch');
  });
  it('records an error as unavailable evidence without inventing output', () => {
    const error = makeSample('run.1', 'old', { task_id: 'task-1', sample: 2, output: null, error: 'provider_error' });
    const pointer = createPointer(error, { field: 'text', anchor: 0, context: '' });
    expect(pointer).toMatchObject({ sample_error: 'provider_error' });
    expect(resolvePointer(pointer, [error])).toMatchObject({ status: 'supported', view: '[unavailable] recorded error: provider_error' });
    expect(resolvePointer({ ...pointer, sample_error: 'different' }, [error]).status).toBe('unsupported');
  });
  it('rejects broken bounds, quote, view hash, stored hash and sample identity', () => {
    const pointer = createPointer(sample, spanEvidence(output, 'text', 1, 2));
    expect(resolvePointer({ ...pointer, pointer: pointer.pointer.replace('#1-2', '#1-999') }, [sample]).reason).toBe('out_of_bounds');
    expect(resolvePointer({ ...pointer, quote: 'B' }, [sample]).reason).toBe('quote_mismatch');
    expect(resolvePointer({ ...pointer, view_sha256: '0'.repeat(64) }, [sample]).reason).toBe('view_hash_mismatch');
    expect(resolvePointer(pointer, [{ ...sample, output_sha256: '0'.repeat(64) }]).reason).toBe('sample_hash_mismatch');
    expect(resolvePointer(pointer, [{ ...sample, run_id: 'other' }]).reason).toBe('sample_not_found');
    expect(resolvePointer(pointer, [sample, sample]).reason).toBe('ambiguous_sample_identity');
  });
  it.each(['run:a/b/task:b/side:new/sample:1#0-0', 'run:a/task:b/side:next/sample:1#0-0', 'run:a/task:b/side:new/sample:0#0-0',
    'run:a/task:b/side:new/sample:01#0-0', 'run:a/task:b/side:new/sample:1/field:raw#0-0', 'run:a/task:b/side:new/sample:1#2-1',
    'run:a/task:b/side:new/sample:1#0-1junk', 'run:a/task:%2F/side:new/sample:1#0-0'])('rejects charset/grammar ambiguity: %s', (pointer) => {
    expect(() => parsePointer(pointer)).toThrow();
  });
  it('word diff reconstructs each exact view, including whitespace', () => {
    const diff = diffField('text', 'A 😀 old\n', 'A 😀 new\n');
    expect(diff.parts.filter((part) => !part.added).map((part) => part.value).join('')).toBe(diff.old_view);
    expect(diff.parts.filter((part) => !part.removed).map((part) => part.value).join('')).toBe(diff.new_view);
    expect(diff.parts.some((part) => part.added && part.value.includes('new'))).toBe(true);
  });
});
