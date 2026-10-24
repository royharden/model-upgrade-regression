# Normalisation v1

`src/core/regressdiff/normalise.ts` exports `normalise(input, task)` (and the American-spelling alias `normalize`). It is pure and makes no provider call. `NORMALISATION_VERSION` is `normalisation-v1`; `canonical.ts` exports `CANONICAL_VERSION = canonical-v1`.

The rules are applied in this order:

1. Convert CRLF and standalone CR to LF in text and thinking.
2. Remove trailing whitespace from each line and from the end of each field. Preserve leading whitespace and interior whitespace.
3. If the entire answer parses as JSON, serialise it with lexicographically sorted object keys and two-space indentation. Preserve array order and primitive types. Prose containing a JSON fragment remains prose.
4. Parse provider-encoded tool arguments as JSON, sort argument keys recursively, and drop provider call ids from the normalised records. Raw input is neither changed nor included in evidence views.
5. Preserve the provider-order trace in `tool_calls_original`. Copy it into `tool_calls`; only when `independent_tool_calls` is true, stably sort the copy by name, then canonical argument JSON. Retain every duplicate. Re-normalising a stored output retains its original trace.
6. Typed input blocks route `type: thinking` to `thinking` and `type: text` to `text`, joining same-type blocks with LF. Provider adapters must identify these block types. Literal thinking tags in a text block remain text so the leak check can detect them.
7. Do nothing else: preserve case, bullet glyphs, phrasing, leading spaces and tool-call multiplicity.

Absent stop reason, usage and latency are `null`. Unknown provider reason strings become `null`; recognised canonical/OpenAI-compatible reasons are listed in `KNOWN_STOP_REASONS`. Explicit zero token counts or latency stay zero. Invalid tool JSON or malformed measurements throw at the normaliser boundary, allowing callers to record an error sample. Missing thinking becomes an empty string, so `thinking_leak` with `expect_thinking: true` abstains.

The canonical serialiser accepts finite, acyclic JSON values only. It rejects undefined, functions, class instances and non-finite numbers rather than silently losing data. UTF-8 byte counting is implemented without a browser or Node encoder. Task size is measured on the canonical validated task, including applied parameter defaults, and must be at most 8192 bytes.

`hashOutput(output)` hashes the canonical whole output, **including `tool_calls_original`**, with synchronous SHA-256. `hashError(message)` hashes the literal `error:` prefix plus the message. An independent reorder can preserve sorted tool calls while changing the output hash because its original trace differs.

Evidence views are defined once by `fieldView` in `evidence.ts`: text/thinking are their unescaped strings; tool arrays and usage are canonical JSON; scalar reason/latency are plain strings; absent measurements have the explicit `[unavailable]` view. Offsets are zero-based, half-open Unicode code points. `spanEvidence`, `matchEvidence` and `anchorEvidence` create spans or deletion/missing-content anchors. Anchors carry up to 20 code points before and after the anchor. The later pointer resolver must use these same functions and context convention.

Authored tests cover every rule, both branches of independent ordering, duplicate calls, astral characters, integer-like JSON keys, original-trace hashes, nulls and zeros. They have not been executed in Dirty Mode.
