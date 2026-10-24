export function CostBar({ spentUsd = 0, reservedUsd = 0 }: { spentUsd?: number; reservedUsd?: number }) {
  const usd = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  return <section className="cost-bar" aria-label="Demo spend"><strong>Mock spend {usd(spentUsd)}</strong>
    <span>Reserved {usd(reservedUsd)}</span><span>Recorded check costs are synthetic diagnostics, separate from spend.</span></section>;
}
