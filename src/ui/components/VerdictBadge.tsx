export function VerdictBadge({ verdict, label }: { verdict: string; label?: string }) {
  return <span className={`badge badge-${verdict.toLowerCase()}`}>{label ?? verdict.replaceAll('_', ' ')}</span>;
}
