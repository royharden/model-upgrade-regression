import { REFUSAL_PHRASES, REFUSAL_PHRASES_VERSION } from '../checks/refusal.ts';
import { KNOWN_STOP_REASONS } from '../schema/output.ts';

export const FACT_BASELINE_VERSION = 'key-token-facts-v1';
export const REFUSAL_BASELINE_VERSION = `${REFUSAL_PHRASES_VERSION}+known-stop-reasons-v1`;
export type RefusalStyle = 'answered' | 'refused' | 'unknown';
// Versioned lexical heuristic: case folding, Unicode word tokens, and only these function words omitted.
export const FACT_STOP_WORDS = ['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'of', 'to', 'in', 'on', 'at', 'and'] as const;
export function keyTokens(value: string): string[] {
  return [...new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => !(FACT_STOP_WORDS as readonly string[]).includes(token)))];
}
export interface FactObservation { fact_kept: boolean | null; missing_facts: string[]; unjudgeable_facts: string[] }
/** Token presence is not entailment: negation, ordering, synonyms and wrong relationships can fool it. */
export function observeFacts(required_facts: readonly string[], text: string): FactObservation {
  const present = new Set(keyTokens(text)), missing_facts: string[] = [], unjudgeable_facts: string[] = [];
  for (const fact of required_facts) {
    const tokens = keyTokens(fact);
    if (!tokens.length) unjudgeable_facts.push(fact);
    else if (tokens.some((token) => !present.has(token))) missing_facts.push(fact);
  }
  return { fact_kept: !required_facts.length || unjudgeable_facts.length ? null : missing_facts.length === 0, missing_facts, unjudgeable_facts };
}
/** Shares the deterministic check's phrase inventory and stop-reason semantics without changing the check. */
export function observeRefusal(text: string, stop_reason: string | null): RefusalStyle {
  if (stop_reason === 'refusal' || REFUSAL_PHRASES.some((phrase) => text.toLowerCase().includes(phrase))) return 'refused';
  return stop_reason !== null && (KNOWN_STOP_REASONS as readonly string[]).includes(stop_reason) ? 'answered' : 'unknown';
}
