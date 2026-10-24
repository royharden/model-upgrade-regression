export function EstimatePanel({ taskCount, k, live = false, estimateUsd = null }: { taskCount: number; k: 1 | 3 | 5; live?: boolean; estimateUsd?: number | null }) {
  return <aside className="estimate-panel" aria-label="Comparison estimate"><h3>Before you run</h3>
    <p>{taskCount} tasks × 2 sides × {k} samples = {taskCount * 2 * k} {live ? 'provider calls at most (before manual retries)' : 'recorded samples'}.</p>
    <p><strong>{live ? estimateUsd === null ? 'Live estimate unavailable — starting disabled' : `Reservation upper bound: USD ${estimateUsd.toFixed(6)}` : 'Estimated spend: USD 0.00 (mock)'}</strong></p>
    <p>{live ? 'Server rechecks the frozen model configuration and each reservation. Unknown billing and changed configuration stop dispatch.' : 'Live estimate unavailable: no verified model prices.'}</p>
  </aside>;
}
