interface FieldDiff {
  field: string; old_view: string; new_view: string;
  parts: Array<{ value: string; added?: boolean; removed?: boolean }>;
}
/** All output stays in React text nodes, including markup, tool arguments and fake reports. */
export function DiffView({ diffs }: { diffs: readonly FieldDiff[] }) {
  return <div className="field-diffs">{diffs.map((diff, index) => <section className="field-diff" key={`${diff.field}-${index}`}>
    <h3>{diff.field}</h3>
    <div className="diff-grid">
      <div><h4>Old</h4><pre aria-label={`Old ${diff.field} diff`}>{diff.parts.filter((part) => !part.added).map((part, partIndex) =>
        part.removed ? <mark className="removed" key={partIndex}>{part.value}</mark> : <span key={partIndex}>{part.value}</span>)}</pre></div>
      <div><h4>New</h4><pre aria-label={`New ${diff.field} diff`}>{diff.parts.filter((part) => !part.removed).map((part, partIndex) =>
        part.added ? <mark className="added" key={partIndex}>{part.value}</mark> : <span key={partIndex}>{part.value}</span>)}</pre></div>
    </div>
    <p className="muted">Removed text is red; added text is green. Offsets refer to the canonical field views below.</p>
    <details><summary>Exact evidence views</summary><div className="diff-grid"><pre>{diff.old_view}</pre><pre>{diff.new_view}</pre></div></details>
  </section>)}</div>;
}
