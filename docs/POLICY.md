# Suite policy and migration reports

`compare` validates an optional policy with the strict `PolicySchema`; absence uses `fixtures/policy.json`. Invalid suite, manifest, recordings or policy is invalid input, not a safe comparison. No provider or model-judge argument enters verdict, policy or report functions.

Policy names `max_regressions`, `always_blocking`, cost/latency `per_task_median` and `suite_total` caps, `allow_waive_blocking`, and `block_preexisting_hazards`. A null cap disables that cap. Caps are absolute **new-side** values: each task uses its median over all k samples and a suite total sums those task medians. Multiple checks do not multiply a task's measurements. Missing metrics never shrink k: unavailable cap measurements add `R_CAP_UNAVAILABLE` and REVIEW. A known partial sum already over its cap still blocks. Offline costs use synthetic check prices, not spend (mock spend is USD0.00).

Blocking rules, evaluated before review rules:

- **B1:** an active always-blocking check is REGRESSED.
- **B2:** an active always-blocking check has any observed new-side failure and old-side passes are a strict majority of its judged non-error samples. This includes WITHIN_NOISE, UNCHANGED with instability, and COULD_NOT_JUDGE. No old judged samples or an old failure majority cannot establish this safety baseline.
- **B3:** the non-waived REGRESSED count exceeds `max_regressions`.
- **B4:** a configured cost or latency cap is exceeded. Waivers cannot lift hard caps.
- **B_PREEXISTING_HAZARD:** a PRE_EXISTING always-blocking failure with `block_preexisting_hazards=true`.

Waivers leave findings and original severity listed. They remove regressions from B3's effective count, but do not lift B1/B2 unless `allow_waive_blocking=true`. The default is false. Confirming a regression does not waive it. `decision` preserves raw policy, effective policy, raw/effective regression counts, ignored blocking waivers, hard-cap breaches and block-causing finding IDs.

Without a blocking rule, REVIEW names every applicable reason: `R_COULD_NOT_JUDGE`, `R_UNSUPPORTED`, `R_NEEDS_REVIEW`, `R_RETEST`, `R_REGRESSED` (within the allowed maximum), `R_PREEXISTING_HAZARD`, `R_CAP_UNAVAILABLE`, or `R_NOTHING_JUDGED`. Rulings do not rewrite evidence or cell verdicts. A confirmed/waived COULD_NOT_JUDGE remains a review note, but resolves its CLI uncertainty status. Retest leaves it unresolved. Otherwise the suite is SAFE_WITH_NOTES (`S_NO_BLOCK_OR_REVIEW_RULE`), retaining noise, ordinary pre-existing failures, improvements, waivers and diagnostic statistics.

CLI exits: BLOCK → 1; otherwise unresolved COULD_NOT_JUDGE or nothing judged → 2 with `error_kind: "could_not_judge"`; otherwise → 0 (including a printed REVIEW). Invalid input is exit 2 with `error_kind: "invalid_input"` and a distinct stderr line. A blocking rule takes precedence over uncertainty exit 2.

Worst-first order is block-causing findings, REGRESSED (always-blocking first, then check family), unsupported, COULD_NOT_JUDGE, retest/NEEDS_REVIEW, WITHIN_NOISE, PRE_EXISTING, IMPROVED. Ties use task ID then check ID. Waivers keep their original severity and ranking. UNCHANGED cells remain available in the cell table; an UNCHANGED B2 hazard is retained as a finding because it needs action.

JSON (`migration-report-v1`) and Markdown use the same pure report model. Fixed sections are: verdict + named rule; deltas/statistics; regressed; re-test/could-not-judge/unsupported/needs-review; pre-existing; within noise; improved; waived; raw and effective policy; full ruling audit. The audit retains orphaned events. Statistics are diagnostic and never change a cell. Markdown escapes untrusted evidence as data. JSON retains the original evidence data under typed fields; model text cannot replace verdicts, pointers, sections or report prose.

`tests/core/regressdiff/policy.test.ts` covers named rules, waivers, cap medians, pre-existing hazards and uncertainty exits. `report-model-boundary.test.ts` covers the fixed report, audit and adversarial instructions/forged pointers/HTML/report JSON. These authored tests remain unexecuted during Dirty Mode. UI/CLI integration and full type/lint/build/runtime validation are tracked in `DEFERRED-VALIDATION.md`.
