/** Design-only interfaces. No implementation, credentials, SDK, provider calls or registration hook. */
export interface SemanticAdapterInput { required_facts: readonly string[]; text: string; stop_reason: string | null }
export interface SemanticAdapterJudgment { fact_kept: boolean | null; refusal_style: 'answered' | 'refused' | 'unknown' }
/** Future server-side seam only. No implementation is shipped or consumed by compare/slot. */
export interface SemanticAdapterContract { judge(input: SemanticAdapterInput): Promise<SemanticAdapterJudgment> }
export interface DisabledSemanticAdapter {
  readonly id: 'generative-judge' | 'jev'; readonly enabled: false; readonly status: 'not evaluated';
  readonly model: string | null; readonly execution: 'unimplemented'; readonly documentation: 'verification deferred';
}
export const DISABLED_SEMANTIC_ADAPTERS: readonly DisabledSemanticAdapter[] = [
  { id: 'generative-judge', enabled: false, status: 'not evaluated', model: null, execution: 'unimplemented', documentation: 'verification deferred' },
  { id: 'jev', enabled: false, status: 'not evaluated', model: 'jev-1.13.0', execution: 'unimplemented', documentation: 'verification deferred' },
];
