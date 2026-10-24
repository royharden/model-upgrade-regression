export function RunProgress({ completed, total, busy }: { completed: number; total: number; busy: boolean }) {
  if (!total) return null;
  return <div className="run-progress" role="status" aria-live="polite">
    <label>Recorded sample progress <progress value={completed} max={total} /></label>
    <span>{completed}/{total} recorded samples · {busy ? 'Replaying' : completed === total ? 'Replay complete' : 'Replay stopped'}</span>
  </div>;
}
