import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../src/ui/', import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(directory, entry.name)) :
    entry.name.endsWith('.tsx') ? [readFileSync(join(directory, entry.name), 'utf8')] : []);
}
describe('offline review surface source boundaries', () => {
  it('has no HTML injection sink or network client on the demo/review path', () => {
    // A model can emit HTML, fake pointers or report-shaped JSON; source data must remain React text.
    const source = sources(root).join('\n');
    expect(source).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\s*\(/u);
    const offline = ['App.tsx', 'pages/Setup.tsx', 'pages/Run.tsx', 'pages/Findings.tsx', 'pages/Finding.tsx', 'pages/Report.tsx',
      'pages/SemanticFinding.tsx', 'components/CostBar.tsx', 'components/EstimatePanel.tsx', 'components/RulingButtons.tsx'].map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
    expect(offline).not.toMatch(/\bfetch\s*\(|from\s+['"][^'"]*supabase/u);
    expect(readFileSync(join(root, 'App.tsx'), 'utf8')).toContain("lazy(() => import('./pages/Live.tsx'))");
  });
  it('retains suite paste/upload validation and uses shared core report exports', () => {
    const run = readFileSync(join(root, 'pages', 'Run.tsx'), 'utf8');
    expect(run).toContain('SuiteSchema.parse(JSON.parse(text))'); expect(run).toContain('type="file"');
    const report = readFileSync(join(root, 'pages', 'Report.tsx'), 'utf8');
    expect(report).toContain('renderMarkdown(report)'); expect(report).toContain('renderJson(report)');
  });
  it('keeps supplied block-causing findings visible and resolves stored evidence pointers', () => {
    const findings = readFileSync(join(root, 'pages', 'Findings.tsx'), 'utf8');
    expect(findings).toContain('reviewItems(comparison).map('); expect(findings).toContain('finding.block_causing');
    const detail = readFileSync(join(root, 'pages', 'Finding.tsx'), 'utf8');
    expect(detail).toContain('resolvePointer(pointer, samples)');
    expect(detail).toContain('finding.original_severity'); expect(detail).toContain('finding.current_ruling');
  });
  it('routes semantic IDs through the same reasoned Demo and Live ruling flow', () => {
    for (const page of ['Run.tsx', 'Live.tsx']) {
      const source = readFileSync(join(root, 'pages', page), 'utf8');
      expect(source).toContain('comparison?.semantic_reviews.find('); expect(source).toContain('<SemanticFinding ');
      expect(source).toContain('finding_id'); expect(source).toContain('reason.trim()');
    }
    const detail = readFileSync(join(root, 'pages', 'SemanticFinding.tsx'), 'utf8');
    expect(detail).toContain('<RulingButtons key={review.id} onRule={onRule} />');
    expect(detail).toContain('Unsupported evidence still requires review after a ruling.');
  });
});
