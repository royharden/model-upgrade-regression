import { canonical } from '../canonical.ts';
import type { EvidenceFinding } from '../findings.ts';
import type { SuiteStatistic } from '../stats/index.ts';
import type { MigrationReport } from './json.ts';
import { semanticPending, type SemanticReview } from '../semantic/slot.ts';
// Data cannot introduce Markdown headings, links, HTML, or fences into the template.
const text = (value: unknown): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_[\]{}()#+.!|~-]/g, '\\$&').replace(/\r?\n/g, ' ↵ ');
function diagnosticCounts(line: SuiteStatistic): string {
  return 'check_type' in line
    ? `excluded could-not-judge=${line.excluded_could_not_judge}; excluded missing=${line.excluded_missing}`
    : `task pairs=${line.task_pairs}; excluded tasks=${line.excluded_tasks}; excluded unknown usage=${line.excluded_unknown_usage}; excluded unknown metric=${line.excluded_unknown_metric}; excluded missing output=${line.excluded_missing_output}; zero differences=${line.zero_differences}`;
}
function list(findings: readonly EvidenceFinding[]): string {
  if (!findings.length) return 'None.\n';
  return findings.map((finding) => {
    const pointers = (['old', 'new'] as const).map((side) => `${side}: ${finding.pointers[side].map((pointer) => `${text(pointer.pointer)}; view sha256 ${text(pointer.view_sha256)}; ${pointer.sample_error !== undefined ? `recorded error ${text(pointer.sample_error)}; ` : ''}${pointer.context !== undefined ? `anchor context ${text(pointer.context)}` : `quote ${text(pointer.quote)}`}`).join(' / ')}`).join('\n  - ');
    return `- ${text(finding.task_id)} / ${text(finding.check_id)} (${text(finding.check_type)}): ${text(finding.original_severity)}; ${finding.block_causing ? 'BLOCK-causing; ' : ''}${text(finding.support)}; effective ruling ${text(finding.current_ruling?.kind ?? 'none')}\n  - ${pointers}\n  - ${finding.evidence.new.map(({ result }) => `${text(result.detail)}; expected ${text(canonical(result.expected))}; observed ${text(canonical(result.observed))}`).join(' / ')}${finding.support_reasons.length ? `\n  - ${finding.support_reasons.map(text).join('; ')}` : ''}`;
  }).join('\n') + '\n';
}
function semanticList(items: readonly SemanticReview[]): string {
  if (!items.length) return 'Semantic reviews: none.\n';
  return 'Semantic reviews (append-only; deterministic cells unchanged):\n\n' + items.map((item) =>
    `- ${text(item.task_id)} / ${text(item.baseline)}: NEEDS\\_REVIEW; ${semanticPending(item) ? 'pending' : 'resolved'}; ${text(item.support)}; effective ruling ${text(item.current_ruling?.kind ?? 'none')}; baseline ${text(item.baseline_version)}; id ${text(item.id)}\n  - ${text(item.detail)}\n  - Required facts ${text(canonical(item.required_facts))}; declared refusal expectation ${text(item.expected_refusal ?? 'none')}; observations ${text(canonical(item.observations))}\n  - ${(['old', 'new'] as const).map((side) => `${side}: ${item.pointers[side].map((pointer) => `${text(pointer.pointer)}; view sha256 ${text(pointer.view_sha256)}; ${pointer.context !== undefined ? `anchor context ${text(pointer.context)}` : `quote ${text(pointer.quote)}`}${pointer.sample_error !== undefined ? `; recorded error ${text(pointer.sample_error)}` : ''}`).join(' / ')}`).join('\n  - ')}${item.support_reasons.length ? `\n  - ${item.support_reasons.map(text).join('; ')}` : ''}`
  ).join('\n') + '\n' + items.map((item) => `- ${text(item.task_id)} / ${text(item.baseline)}: canonical word diffs, paired sample ${item.diff_sample}\n` +
    item.diffs.map((diff) => `  - Field ${text(diff.field)}; old view ${text(diff.old_view)}; new view ${text(diff.new_view)}\n  - Word diff: ${diff.parts.map((part) => `${part.added ? '[added]' : part.removed ? '[removed]' : '[equal]'} ${text(part.value)}`).join(' / ')}`).join('\n')).join('\n') + '\n';
}
export function renderMarkdown(report: MigrationReport): string {
  const { decision, findings, stats } = report;
  const sections = [
    `## Verdict + named rule\n\n${decision.verdict}; rules: ${decision.rules.map(text).join(', ')}; CLI exit ${decision.exit_code}.${decision.error_kind ? ` Error kind: ${text(decision.error_kind)}.` : ''}\n\nRun ${text(report.manifest.run_id)}; ${text(report.manifest.old_model.id)} → ${text(report.manifest.new_model.id)}; k=${report.manifest.k}.\n\nCost basis: ${text(report.cost_basis)}.\n${decision.notes.map((note) => `\n- ${text(note)}`).join('')}`,
    `## Deltas (stats lines)\n\nDiagnostic only. BH q=${stats.correction.q}; denominator ${stats.correction.denominator} of ${stats.preregistered_tests} preregistered tests; seed ${stats.seed}.\n\n${stats.tests.map((line) => `- ${text(line.id)}: ${text(line.method)}; ${text(line.status)}; n=${line.n}; raw p=${line.raw_p ?? 'N/A'}; adjusted p=${line.adjusted_p ?? 'N/A'}; ${diagnosticCounts(line)}`).join('\n')}\n\n${stats.continuous.map((line) => `- ${text(line.metric)}: median paired difference ${line.median_difference ?? 'N/A'} ${text(line.unit)}; bootstrap 95% CI ${line.bootstrap ? `[${line.bootstrap.lower}, ${line.bootstrap.upper}], ${line.bootstrap.iterations} resamples` : 'N/A'}`).join('\n')}`,
    `## Regressed\n\n${list(findings.filter((finding) => finding.verdict === 'REGRESSED'))}`,
    `## Re-test / could-not-judge / unsupported / needs-review\n\n${list(findings.filter((finding) => finding.verdict === 'COULD_NOT_JUDGE' || finding.support === 'unsupported' || finding.current_ruling?.kind === 'retest' || (finding.verdict === 'UNCHANGED' && finding.block_causing)))}\n${semanticList(report.semantic_reviews)}`,
    `## Pre-existing\n\n${list(findings.filter((finding) => finding.verdict === 'PRE_EXISTING'))}`,
    `## Within noise\n\n${list(findings.filter((finding) => finding.verdict === 'WITHIN_NOISE'))}`,
    `## Improved\n\n${list(findings.filter((finding) => finding.verdict === 'IMPROVED'))}`,
    `## Waived\n\n${list(findings.filter((finding) => finding.current_ruling?.kind === 'waived'))}\n${semanticList(report.semantic_reviews.filter((item) => item.current_ruling?.kind === 'waived'))}`,
    `## Raw and effective policy\n\nRaw: ${text(canonical(decision.raw_policy))}\n\nEffective: ${text(canonical(decision.effective_policy))}\n\nRegression count: raw ${decision.regressed_count}; effective ${decision.effective_regressed_count}.\n\nHard-cap breaches: ${text(canonical(decision.cap_breaches))}`,
    `## Full ruling audit\n\n${report.ruling_audit.length ? report.ruling_audit.map((event) => `- ${text(canonical(event))}`).join('\n') : 'None.'}\n\nOrphaned events retained: ${report.orphaned_rulings.length}.\n${report.orphaned_rulings.map((event) => `\n- ${text(canonical(event))}`).join('')}`,
  ];
  return `# Model-upgrade migration report\n\n${sections.join('\n\n')}\n`;
}
