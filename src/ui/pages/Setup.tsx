export function Setup({ onDemo }: { onDemo: () => void }) {
  return <section className="panel">
    <h2>Explore a recorded comparison</h2>
    <p>Compare 40 synthetic tasks across two recorded models. Outputs, proposed tool calls and errors are replayed locally.</p>
    <p>No API key or sign-in is needed. The demo stores evidence and rulings for this session.</p>
    <button onClick={onDemo}>Demo</button>
    <p>Select Live separately for connection setup and sign-in. Live calls require backend provisioning, an owner allowlist grant, your spend cap and verified model prices.</p>
  </section>;
}
