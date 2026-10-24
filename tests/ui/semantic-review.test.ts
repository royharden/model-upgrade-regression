import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compare, type Comparison } from '../../src/core/regressdiff/compare.ts';
import { makeSample } from '../../src/core/regressdiff/pairing.ts';
import { normalise } from '../../src/core/regressdiff/normalise.ts';
import { Findings } from '../../src/ui/pages/Findings.tsx';
import { SemanticFinding } from '../../src/ui/pages/SemanticFinding.tsx';
import { reviewItems, semanticEvidence } from '../../src/ui/review-items.ts';
import { demoSuite, runDemo } from '../../src/lib/demo.ts';
import { MemoryStore } from '../../src/lib/store/memory.ts';
import { scenario, safe, relaxedPolicy, ruling } from '../core/regressdiff/m3-fixtures.ts';

function semanticComparison(task_ids: readonly string[] = ['semantic'], next = '<script>alert(1)</script>', extraChecks = false): Comparison {
  const tasks = task_ids.map((id) => ({ id, category: 'semantic' as const, required_facts: ['Mercury is closest'],
    messages: [{ role: 'user' as const, content: 'A fixture question' }], tools: [], independent_tool_calls: false,
    checks: [{ id: 'length', type: 'length' as const, params: { min: 1, unit: 'chars' as const } },
      ...(extraChecks ? ['z-check', 'a-check'].map((check_id) => ({ id: check_id, type: 'equals' as const, params: { value: 'ok' } })) : [])] }));
  return compare({ suite: { id: 'semantic-ui', name: 'Semantic UI', tasks }, run_id: 'semantic-ui', owner_id: 'owner',
    args: { k: 1, old_model: 'mock:old', new_model: 'mock:new' }, policy: relaxedPolicy,
    samples: tasks.flatMap((task) => (['old', 'new'] as const).map((side) => makeSample('semantic-ui', side, { task_id: task.id, sample: 1,
      output: normalise({ ...safe, text: side === 'old' ? 'Mercury is closest' : next }, task) }))) });
}
describe('semantic review presentation uses shared core data', () => {
  it('orders semantic tasks and baseline ties independently of reversed suite/review order', () => {
    const comparison = semanticComparison(['z', 'a'], 'I cannot help with that request.');
    expect(comparison.suite.tasks.map((task) => task.id)).toEqual(['z', 'a']);
    const expected = ['a/key-token-facts', 'a/refusal-style', 'z/key-token-facts', 'z/refusal-style'];
    for (const semantic_reviews of [comparison.semantic_reviews, [...comparison.semantic_reviews].reverse()]) {
      expect(reviewItems({ ...comparison, semantic_reviews }).map((item) => item.kind === 'semantic' ? `${item.value.task_id}/${item.value.baseline}` : 'unexpected deterministic finding'))
        .toEqual(expected);
    }
  });
  it.each(['unsupported', 'retest'] as const)('ties mixed %s items by task and check/baseline keys, retaining waived placement', (bucket) => {
    const comparison = semanticComparison(['z', 'a'], 'ok', true);
    const ranked: Comparison = { ...comparison,
      findings: comparison.findings.map((finding) => bucket === 'unsupported' ? { ...finding, support: 'unsupported' as const }
        : { ...finding, current_ruling: { ...ruling(finding.id, 'retest'), id: `retest-${finding.task_id}-${finding.check_id}` } }),
      semantic_reviews: comparison.semantic_reviews.map((review) => bucket === 'unsupported' ? { ...review, support: 'unsupported' as const } : review) };
    const ordered = reviewItems(ranked);
    expect(ordered.map((item) => `${item.value.task_id}/${item.kind === 'semantic' ? item.value.baseline : item.value.check_id}`))
      .toEqual(['a/a-check', 'a/key-token-facts', 'a/z-check', 'z/a-check', 'z/key-token-facts', 'z/z-check']);
    const waived: Comparison = { ...ranked,
      semantic_reviews: ranked.semantic_reviews.map((review) => ({ ...review, current_ruling: { ...ruling(review.id, 'waived'), id: `waive-${review.task_id}` } })),
      findings: bucket === 'unsupported' ? ranked.findings.map((finding) => ({ ...finding,
        current_ruling: { ...ruling(finding.id, 'waived'), id: `waive-${finding.task_id}-${finding.check_id}` } })) : ranked.findings };
    expect(reviewItems(waived).map((item) => item.value.id)).toEqual(ordered.map((item) => item.value.id));
  });
  it('keeps core blocking/regression family order and an ordinary B3 waiver position in the semantic merge', async () => {
    const store = new MemoryStore(), args = { k: 3 as const, old_model: 'mock:old', new_model: 'mock:new' };
    const { comparison, run } = await runDemo(demoSuite, args, store);
    const before = reviewItems(comparison);
    expect(before.filter((item) => item.kind === 'deterministic').map((item) => item.value.id))
      .toEqual(comparison.findings.map((finding) => finding.id));
    const prefix = comparison.findings.find((finding) => finding.task_id === 'fmt.prefix')!;
    const thinking = comparison.findings.find((finding) => finding.task_id === 'con.thinking')!;
    expect(before.findIndex((item) => item.value.id === prefix.id)).toBeLessThan(before.findIndex((item) => item.value.id === thinking.id));
    expect(prefix.block_causing).toBe(true);
    store.addRuling({ ...ruling(prefix.id, 'waived'), owner_id: store.owner_id, run_id: run.id });
    const replayed = compare({ suite: demoSuite, args, samples: store.listSamples(run.id), run_id: run.id, owner_id: store.owner_id,
      manifest: run.manifest, rulings: store.listRulings() });
    expect(reviewItems(replayed).map((item) => item.value.id)).toEqual(before.map((item) => item.value.id));
    expect(replayed.findings.find((finding) => finding.id === prefix.id))
      .toMatchObject({ block_causing: false, original_severity: 'REGRESSED', current_ruling: { kind: 'waived' } });
    expect(replayed.decision.effective_regressed_count).toBe(comparison.decision.effective_regressed_count - 1);
  });
  it('inserts review items after deterministic uncertainty and before noise, retaining core order and waived position', () => {
    const comparison = semanticComparison(), review = comparison.semantic_reviews[0];
    expect(review).toBeDefined();
    const regression = scenario([safe], [{ ...safe, text: 'wrong' }]).findings[0];
    const uncertain = scenario([safe], [null]).findings[0];
    const noise = scenario([safe, safe, safe], [safe, safe, { ...safe, text: 'wrong' }]).findings[0];
    const items = { ...comparison, findings: [regression, uncertain, noise], semantic_reviews: [review] };
    expect(reviewItems(items).map((item) => item.value.id)).toEqual([regression.id, uncertain.id, review.id, noise.id]);
    const waived = { ...review, current_ruling: { id: 'waive', finding_id: review.id, owner_id: 'owner', run_id: 'semantic-ui',
      kind: 'waived' as const, reason: 'Human reviewed the lexical miss', created_at: '2026-10-24T00:00:00.000Z', supersedes: null } };
    expect(reviewItems({ ...items, semantic_reviews: [waived] }).map((item) => item.value.id)).toEqual([regression.id, uncertain.id, review.id, noise.id]);
    expect(reviewItems({ ...items, semantic_reviews: [{ ...waived, support: 'unsupported' }] }).map((item) => item.value.id)).toEqual([regression.id, review.id, uncertain.id, noise.id]);
  });
  it('renders hostile semantic detail, pointer quotes and ruling reasons as escaped text with the reasoned controls', () => {
    const comparison = semanticComparison(), original = comparison.semantic_reviews[0];
    const hostile = '<img src=x onerror=alert(1)>';
    const review = { ...original, detail: hostile, current_ruling: { id: 'rule', finding_id: original.id, owner_id: 'owner', run_id: 'semantic-ui',
      kind: 'confirmed' as const, reason: hostile, created_at: '2026-10-24T00:00:00.000Z', supersedes: null } };
    const detail = renderToStaticMarkup(createElement(SemanticFinding, { comparison, review, onBack: () => {}, onRule: () => true }));
    const list = renderToStaticMarkup(createElement(Findings, { comparison: { ...comparison, semantic_reviews: [review] }, onOpen: () => {}, onReport: () => {} }));
    for (const markup of [detail, list]) { expect(markup).toContain('&lt;img'); expect(markup).not.toContain('<img'); }
    expect(detail).toContain('&lt;script&gt;'); expect(detail).not.toContain('<script>');
    expect(detail).toContain('Old text diff'); expect(detail).toContain('New text diff'); expect(detail).toContain('✓ supported');
    const evidence = semanticEvidence(comparison, review);
    expect(evidence.samples).toHaveLength(2); expect(evidence.diffs[0]).toMatchObject({ field: 'text', old_view: 'Mercury is closest', new_view: '<script>alert(1)</script>' });
    expect(evidence.diffs[0].parts.some((part) => part.added)).toBe(true);
    for (const label of ['Reason (required for every ruling)', 'Confirm', 'Waive', 'Retest']) expect(detail).toContain(label);
    expect(detail).toContain('Unsupported evidence still requires review after a ruling.');
  });
});
