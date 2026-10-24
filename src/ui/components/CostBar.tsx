export function CostBar({ spentUsd = 0, reservedUsd = 0, live = false, unknownUsd = 0, capUsd = null }: {
  spentUsd?: number; reservedUsd?: number; live?: boolean; unknownUsd?: number; capUsd?: number | null;
}) {
  const usd = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  return <section className="cost-bar" aria-label={live ? 'Your live budget' : 'Demo spend'}><strong>{live ? 'Settled spend' : 'Mock spend'} {usd(spentUsd)}</strong>
    <span>Reserved total {usd(reservedUsd)}</span>{live ? <><span>Unknown liability {usd(unknownUsd)} (included in reserved)</span>
      <span>Remaining cap {capUsd === null ? 'unset — live blocked' : usd(Math.max(0, capUsd - spentUsd - reservedUsd))}</span>
      <span>Budget is your account only. Deployment cap failures disclose no other users’ data.</span></> : <span>Recorded check costs are synthetic diagnostics, separate from spend.</span>}</section>;
}
