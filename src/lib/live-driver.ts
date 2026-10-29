import type { Sample } from '../core/regressdiff/pairing.ts';
import type { StoredRun } from './store/types.ts';
import type { Attempt, SampleRequest, SampleResponse } from './store/supabase.ts';

export interface LivePort { listSamples(id: string): Promise<Sample[]>; attempts(id: string): Promise<Attempt[]>; sample(request: SampleRequest): Promise<SampleResponse> }
export interface LiveProgress { completed: number; total: number; state: 'running' | 'paused' | 'complete'; reason: string | null }
const key = (value: { task_id: string; side: string; sample: number }) => `${value.task_id}/${value.side}/${value.sample}`;
/** Browser-owned queue only. Pausing never aborts a dispatched paid call or rolls back its reservation. */
export class LiveDriver {
  private paused = false;
  private active = false;
  pause(): void { this.paused = true; }
  async run(run: StoredRun, port: LivePort, onProgress: (value: LiveProgress) => void,
    options: { retryFailed?: boolean; requestId?: () => string } = {}): Promise<LiveProgress> {
    if (this.active) throw new Error('driver_already_running');
    this.active = true; this.paused = false;
    const total = run.suite.tasks.length * 2 * run.args.k;
    let completed = 0, reason: string | null = null;
    const stop = (next: string) => { this.paused = true; if (reason !== 'config_changed') reason = next; };
    try {
      const stored = await port.listSamples(run.id), attempts = await port.attempts(run.id), done = new Set(stored.map(key));
      completed = done.size;
      const queue: Omit<SampleRequest, 'request_id'>[] = [];
      for (const task of run.suite.tasks) for (const side of ['old', 'new'] as const) for (let sample = 1; sample <= run.args.k; sample++) {
        const request = { op: 'sample' as const, run_id: run.id, task_id: task.id, side, sample };
        if (!done.has(key(request))) queue.push(request);
      }
      // Any previous attempt without a stored sample requires an explicit user decision. Claimed/dispatched stays blocked.
      const unresolved = attempts.filter((attempt) => !done.has(key(attempt)));
      if (unresolved.some((attempt) => ['claimed', 'dispatched'].includes(attempt.status))) { this.paused = true; reason = 'in_flight'; }
      else if (unresolved.length && !options.retryFailed) { this.paused = true; reason = 'retry_requires_confirmation'; }
      const emit = () => onProgress({ completed, total, state: this.paused ? 'paused' : 'running', reason });
      emit();
      let cursor = 0;
      const worker = async () => {
        while (!this.paused && cursor < queue.length) {
          const request = queue[cursor++];
          try {
            const response = await port.sample({ ...request, request_id: (options.requestId ?? (() => crypto.randomUUID()))() });
            if (response.error_code || response.ledger_outcome === 'unknown_liability' || response.status === 'overrun' || !response.sample) {
              stop(response.error_code ?? response.ledger_outcome ?? response.status);
            } else {
              completed++;
              const row = response.sample as { error?: unknown };
              if (row.error != null) stop('recorded_sample_error');
            }
          } catch (failure) {
            stop(failure instanceof Error ? failure.message : 'transport_outcome_unknown');
          }
          emit();
        }
      };
      await Promise.all([worker(), worker()]);
      const result: LiveProgress = { completed, total, state: !this.paused && completed === total ? 'complete' : 'paused', reason: reason ?? (!this.paused && completed === total ? null : 'user_paused') };
      onProgress(result); return result;
    } finally { this.active = false; }
  }
}
