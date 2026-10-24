# Deterministic checks

`checks/index.ts` registers exactly 18 types. Call `runCheck({id, type, params}, output, context?)`. Every result contains `status: pass | fail | error`, canonical-field evidence, `expected`, `observed` and a deterministic `detail`. `checks[type].params` is the strict Zod parameter schema used both by the suite validator and runtime boundary. Unknown params are rejected. No expressions or tool handlers execute.

Text checks accept optional `field: text | thinking` (default `text`). Parameter defaults apply during suite validation and at the runtime boundary.

| Type | Params besides optional text field | Semantics |
| --- | --- | --- |
| equals | `value: string` | Exact case-sensitive equality. |
| contains | `value: nonempty string` | Literal case-sensitive substring. |
| regex | `pattern`, `flags?` (default `u`) | Guarded regex search. Only unique `i,m,s,u` flags. |
| is_json | none | Entire field parses as JSON, including JSON primitives. |
| json_schema | `schema: object | boolean` | Ajv validation of the parsed whole field. |
| length | `min?`, `max?`, `unit?: chars | words` | At least one inclusive bound; min <= max; chars means Unicode code points, words means whitespace-separated tokens. |
| starts_with | `value: nonempty string` | Case-sensitive prefix. |
| bullet_count | `min`, `max` | Count lines starting with optional whitespace, `-`, `*`, `•`, or digits followed by `.`/`)`, whitespace and content; inclusive bounds. |
| no_banned_words | `words: nonempty string[]`, `case_sensitive?: false` | Literal substrings/phrases (not word-boundary matching), with Unicode case-insensitive matching by default. |
| thinking_leak | `expect_thinking?: false`, `tags?: string[]` | Fail for a configured tag or a copied contiguous span of at least 40 code points from thinking; case-sensitive. |
| refusal | `expected: answered | refused` | Refusal reason or a versioned case-insensitive phrase hit; unknown reason without a phrase is error. |
| stop_reason | `expected: nonempty string` | Exact reason; absent reason is error. |
| tool_called | `name`, `min?: 1` | At least min occurrences of the named tool. |
| tool_args | `name`, exactly one of `expected` JSON or `schema` | Every occurrence must match canonical JSON or Ajv schema; no occurrence fails. |
| tool_order | `names: nonempty string[]` | Required subsequence of `tool_calls_original`, including duplicate names. |
| tool_forbidden | `name` | No occurrences; observed reports multiplicity. |
| cost_budget | `max_usd` | Reported usage times run-manifest check prices; inclusive cap. |
| latency_budget | `max_ms` | Inclusive recorded latency cap; null is error. |

Only the first nine rows accept `field`. All bounds are finite and nonnegative; count bounds are integers. Thinking leakage, refusal, tool and measurement checks select their own evidence fields.

`thinking_leak` defaults to `<thinking>`, `</thinking>`, `<think>`, `</think>`. Required but absent thinking yields error unless a visible text tag already establishes failure. Exact boilerplate shared with thinking can cause false positives; paraphrases are missed. The phrase list version is `refusal-phrases-v1` in `refusal.ts`. Hedged refusals absent from that list are a named miss; a known non-refusal stop reason alone cannot establish substantive answer quality.

Regex patterns are capped at 200 code points and targets at 65536 UTF-8 bytes. The conservative parser rejects backreferences, lookarounds/special groups, nested repetition, quantified alternations, lazy quantifiers and unsupported flags. Invalid/rejected regex or an oversized target returns error. This is a bounded subset, **not a general ReDoS-safety guarantee**. `suiteWarnings(suite)` identifies rejected regex configurations and Ajv-invalid check schemas before running. Runtime target size cannot be known from suite configuration.

JSON Schema uses Ajv with no `loadSchema`, network or async support. Only local fragment `$ref` is allowed. Remote references and async schemas are rejected by params/suite validation and abstain when supplied directly to runtime. Invalid schemas yield error; valid schema with malformed output JSON yields fail. Tool input schemas use the same local-only boundary.

Cost context is `{check_prices: {currency: USD, input_per_mtok, output_per_mtok, verified_date, synthetic, ...}}`. Mock spend remains zero elsewhere; its check prices are synthetic and result detail labels them `synthetic check price, not spend`. Live prices require a non-null verification date. Missing usage, prices or required separate reasoning information yields error. Reported output tokens include reasoning by default; when `reasoning_in_output_tokens: false`, add `reasoning_tokens * reasoning_per_mtok`. Prices and usage must be finite/nonnegative. The cost-jump authored test changes token counts and asserts the pass becomes fail; M4 will test the actual injector through this contract.

Evidence uses the narrowest available literal/regex/tag/copied-span match, offending tool-call span, or scalar measurement. Whole-field evidence is used for aggregate constraints and JSON validation; missing content has an anchor/context. `tool_args` identifies the first violating occurrence. `tool_order` failures anchor the missing subsequence at the end of the original trace. All tool-call lists are data and never execute.

All types have authored pass, fail and error tests, plus shared evidence integrity assertions. Errors include invalid params for every type and unavailable/invalid schema/measurement cases where applicable. These tests have not been run.
