export function EstimatePanel({ taskCount, k }: { taskCount: number; k: 1 | 3 | 5 }) {
  return <aside className="estimate-panel" aria-label="Comparison estimate"><h3>Before you run</h3>
    <p>{taskCount} tasks × 2 sides × {k} samples = {taskCount * 2 * k} recorded samples.</p>
    <p><strong>Estimated spend: USD 0.00 (mock)</strong></p>
    <p>Live estimate unavailable: no verified model prices.</p>
  </aside>;
}
