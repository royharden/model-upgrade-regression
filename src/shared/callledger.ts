/** Money transitions belong to service-only SQL; this port carries their visible result. */
export type AttemptStatus = 'claimed' | 'dispatched' | 'settled' | 'released' | 'unknown_liability' | 'overrun';
export type LedgerOutcome = 'released' | 'settled' | 'unknown_liability';
export interface LedgerBalance { cap_usd: number | null; spent_usd: number; reserved_usd: number; live_blocked: boolean }
export interface CallAttempt { id: string; request_id: string; status: AttemptStatus; reserve_usd: number; actual_usd: number | null }
