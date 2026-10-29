# Evidence pointers

The pure core creates pointers from deterministic check evidence. Models never supply pointers. The grammar is:

```text
run:<id>/task:<id>/side:<old|new>/sample:<n>[/field:<field>]#<start>-<end>
```

Run/task IDs are 1–64 letters, digits, dots, underscores or hyphens. Samples are positive safe integers. Coordinates are nonnegative safe integers, start ≤ end. No URL decoding or guessed segments is permitted. Omitting the field means `text`, preserving the original spec form. Fields are `text`, `thinking`, `tool_calls`, `tool_calls_original`, `stop_reason`, `usage`, and `latency_ms`. Raw responses are never addressed.

Coordinates are zero-based, half-open **Unicode code points**, not JavaScript UTF-16 units. `text` and `thinking` use their normalised strings. Structured fields use `canonical-v1` stable-key JSON with two-space indentation and LF. Stop reason and latency use plain scalar strings. Null fields use `[unavailable]`, preserving uncertainty rather than inventing a measurement.

Each `EvidencePointer` contains its pointer string, `view_sha256`, and either an exact `quote` or zero-width anchor `context`. Context is the 20 code points before and 20 after the anchor (clipped to the field). Empty answers and deletions can resolve valid zero-width anchors. An astral character such as 😀 occupies one coordinate.

`resolvePointer(pointer, samples)` selects exactly one stored sample by all four identity fields, checks the stored whole-output hash, rebuilds the identical field view, checks the view hash, bounds, and quote or anchor context, and returns `supported` or `unsupported` with a named reason. Duplicate identity, absent sample, mutated output, wrong view hash, out-of-bounds offsets, wrong quote, and wrong anchor context are unsupported. Unsupported findings force REVIEW at minimum; a separate blocking rule still wins.

A recorded provider error has **no normalised output**. Its pointer is a zero-width availability anchor into `[unavailable] recorded error: <error>`, carries `sample_error`, and resolves only against that error record and its `sha256("error:" + error)` hash. It proves the recorded failure to obtain an output; it never proves model content or a passed check. Missing expected samples are explicit `missing_sample` error records made by the pairing layer and receive the same treatment. These cells remain COULD_NOT_JUDGE. Error evidence and unavailable metric markers do not become fabricated answers.

Findings carry old/new pointers for all k samples. Their displayed diff picks a failing new sample when possible and its matching old sample; it applies jsdiff `diffWordsWithSpace` to those same canonical field views. Different evidence fields produce separate field diffs. Tool-only answers use tool fields; `tool_order` uses the provider-order `tool_calls_original` view. The report retains pointer hashes, quotes/contexts, original severity, ruling and support state.

Authored vectors in `tests/core/regressdiff/pointers-resolver.test.ts` and `report-model-boundary.test.ts` cover these boundaries and demo findings at k=3/5. They have not run during Dirty Mode.
