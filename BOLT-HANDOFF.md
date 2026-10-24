# Bolt infrastructure handoff: Model-Upgrade Regression Checker

## Target and readiness

- App root is this inner `model-upgrade-regression` repository, branch `main`; M5 is constructed over baseline `37c552c`. The outer planning shell is not part of the imported app. The repo is local only, has no remote and has never been pushed. A later authorized GitHub import needs an owner-selected repository/revision.
- Database path: **Bolt Database**, a fresh intended target. No existing connection or deployed project is known. Actual applied baseline: **Unknown**. Inspect migration history and schema before any later change; file presence is not application evidence.
- Hosting: Bolt hosting intended; publication: prepare only. The future Bolt action in this handoff is **inspect and prepare only**.
- Status: **source complete, provisioning pending; runtime unverified** for M5. Source and authored tests are not behavioural validation. Dirty Mode permits source/static construction only; no package install, lockfile generation, typecheck, lint, tests, build, app, browser, network, database, Docker or cloud operation has run for M5. M6 remains a separate milestone.
- Owner prerequisites: later GitHub access/import approval, the intended database/auth connection, provider accounts, verified model IDs/prices/billing bounds, an explicit deployment cap and per-user access grants, and server secret entry through settings.

## Build and connection

| Item | Exact command or configuration |
| --- | --- |
| Runtime/package manager | Node 24 is the observed static-parser environment; Node 22+ supported tooling intended, npm; exact package versions in `package.json`. Runtime compatibility is unverified. Deno 2-compatible edge entry intended. |
| Install/lockfile | After Dirty Mode closes: `npm install`, inspect/commit one `package-lock.json`, then `npm ci`. No lockfile exists yet; frozen install is blocked until it does. |
| Dev/build/output | `npm run dev -- --port <claimed-port>` after agent-ports claim/check; `npm run build`; `dist/`. |
| Type/lint/tests | `npm run typecheck`; `npm run lint`; `npm test`. All deferred. Parse-only evidence is recorded in `docs/DEFERRED-VALIDATION.md`; TSX inspection is not rendering or typechecking. |
| Client/public env | `src/lib/supabase.ts`; `.env.example` contains blank `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. HTTPS URL required. No provider/service credentials belong in these values. |
| Missing config | Explicit Live setup message and no client construction. Demo uses fixtures/MemoryStore and no live network module import; Live is lazy loaded separately. |
| Private data transfer | Explicit Live warning and paid-start acknowledgement before prompts/tool schemas/model output are sent to providers and stored. Proposed tools are recorded only; never executed. |

## Database

All five migrations are implemented source; **none has been applied or executed here**.

| Order | Exact migration | Resources/dependencies | Applied status |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/20261024000100_tables.sql` | `suites`, `runs`, `samples`, `rulings`, `budgets`, `app_budget`, `live_access`, `call_attempts`, `ledger_audit`; UUID identities, composite ownership FKs, status/money checks, immutable sample key, one-inflight partial index. Depends on Supabase-compatible `auth.users`, roles and `gen_random_uuid()`. | Unknown/pending |
| 2 | `supabase/migrations/20261024000200_guards.sql` | Immutable suite/version, run/attempt identity, sample/ruling/audit guards and tombstone same-owner/same-finding lineage across runs. | Unknown/pending |
| 3 | `supabase/migrations/20261024000300_functions.sql` | Nine `SECURITY DEFINER` RPCs with pinned search paths; locking order is user budget, global budget, attempt. | Unknown/pending |
| 4 | `supabase/migrations/20261024000400_rls.sql` | RLS on all nine tables, private owner policies, no browser policy for privileged deployment state. | Unknown/pending |
| 5 | `supabase/migrations/20261024000500_grants.sql` | Explicit anon/authenticated revokes and narrow grants; service-role ledger function grants. | Unknown/pending |

Browser access: suites own select/insert/delete (delete only when unreferenced), runs own select, samples own select, rulings own select/insert, budgets/call_attempts own select. All sample writes and run creation are server only. Suite body retains its domain `id`; Store derives an owner/domain-specific database UUID, validates canonical SHA-256 and refuses changing a saved logical version. Browser cap changes use only `set_my_cap(p_cap_usd)`; it cannot change spent/reserved/blocked flags or the deployment cap. Rulings require a reason and are insert-only audit events; tombstones preserve history.

The browser pages private samples/rulings/attempts in batches of 1,000; verify the target API maximum rows is at least 1,000. Budget/history reads are snapshots taken during refresh, not a realtime ledger feed. New reservations are always checked atomically by the server.

RPC inventory:

- Service only: `create_run(p_owner,p_suite_id,p_old_model,p_new_model,p_k,p_manifest)`; `claim_and_reserve(p_run,p_task,p_side,p_sample,p_reserve_usd,p_request_id)`; `mark_dispatched(p_attempt)`; `settle_attempt(p_attempt,p_actual_usd)`; `release_attempt(p_attempt)`; `mark_unknown_liability(p_attempt)`; `reconcile_attempt(p_attempt,p_actual_usd,p_evidence_ref,p_operator,p_reason)`; `unblock_user(p_owner_id,p_reason)`.
- Authenticated caller only: `set_my_cap(p_cap_usd)` binds `auth.uid()` and permits null to disable live spending.
- No additional extensions, storage, Realtime publications, schedules or seeds are required. Confirm built-in UUID/auth support on the actual target. No demo or live-access/global-cap seed is present.

Later owner setup must insert explicit `live_access` grants and a single `app_budget` row (`id=1`) with an approved `global_cap_usd`; browser users set their own caps. Preserve counters when changing caps. Unknown liability keeps reservations counted. Owner reconciliation needs evidence/operator/reason and is one-shot; unknown actual can conservatively consume the full reserve. Overruns block the user; deployment over-cap blocks global dispatch. Unblocking is an audited owner operation, not a browser toggle. The browser never receives other users’ balances or the global totals.

Retry rule: inspect applied migration tracking and schema drift; apply only pending migrations in order. Preserve data, do not replay blindly or drop/recreate on timeout. Stored samples, including recorded errors, are terminal immutable evidence. A repeated request UUID replays its attempt; a fresh UUID permits a fresh reservation only where the sample is still missing. Retesting a stored error requires a new run.

## Function and deployment closure

| Name/source | Caller/auth | Input/output | Resources/secrets | Deploy config |
| --- | --- | --- | --- | --- |
| `run-task`, `supabase/functions/run-task/index.ts` | Signed-in user JWT; gateway `verify_jwt=true`; handler also verifies `auth.getUser()` and reads suite/run through user-scoped RLS before service operations. | Strict union: `{op:'create_run',suite_id,old_model_id,new_model_id,k}` or `{op:'sample',run_id,task_id,side,sample,request_id}`. UUID DB identities/request IDs. Response `{attempt_id,status,run?,sample?,error_code?,ledger_outcome?,missing_secrets?}`. `create_run` returns server-owned frozen manifest. | Nine tables/RPCs above; provider secrets below. | `supabase/config.toml`; `deno.json` import map pins Supabase 2.47.10, Zod 3.24.1, Ajv 8.17.1, noble hashes 1.6.1. |

Source closure: `handler.ts`, `cors.ts`, `live-call.ts`, all `portable/*`, and imported `src/core/regressdiff/*` modules. Portable code has no external imports/runtime I/O. Edge deployment must include these cross-directory core dependencies and resolve the Deno npm map; frontend bundling does not establish this. Deno checking, packaging and deployed function closure are pending. If Bolt's deploy tool excludes root `src/core`, prepare a concrete packaging correction preserving the single canonical core, then review and validate it before deployment. Do not silently copy/fork normalisation or hash semantics.

CORS permits configured exact origins from `ALLOWED_ORIGINS`, POST/OPTIONS and authorization/apikey/content-type/x-client-info headers. CORS is not auth. Recheck gateway behaviour with the chosen project's key/JWT model; never weaken handler identity checks. Missing/foreign run is the same `not_owner` response. Unknown prices, missing secrets, absent allowlist/caps and changed model configuration refuse calls rather than fabricate responses. The UI shows generic deployment/global-cap errors without privileged budget data.

Live is deliberately disabled by shipped placeholder models (`prices:null`, no verified IDs). Before activation, verify actual provider IDs, supported capabilities, USD price date, highest input-side rates, cache/reasoning billing and maximum output bounds in `portable/models.json`; keep its runtime schema mirror aligned. Manifest stores the source config hash and snapshots live check prices from verified prices. Configuration changes pause old runs as `config_changed`; use a new run after review.

Browser queue: tasks × sides × k, concurrency two, resume only absent stored samples, no background worker and no automatic provider retry. Closing/hiding the browser pauses further dispatch; accepted calls may finish server-side. Resume inspects persisted attempts; any missing-sample attempt needs explicit retry acknowledgement, and claimed/dispatched attempts stay blocked pending completion/owner investigation. A user retry creates a fresh request/reservation and retains any earlier unknown liability. UI separates settled/reserved/unknown-liability/remaining-own-cap. Stored error samples require a new run to retest.

## Server secret names

| Name | Consumer | Requirement/owner source |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `live-call.ts` Anthropic adapter | Owner's provider account; required only for that adapter. |
| `OPENAI_COMPAT_API_KEY` | `live-call.ts` compatible adapter | Owner's compatible-provider account. |
| `OPENAI_COMPAT_BASE_URL` | `live-call.ts` compatible adapter | Owner-verified HTTPS API base; `/chat/completions` is appended. No credentials/query/fragment, nonstandard port, IP literal or private/metadata hostname accepted. |
| `OPENAI_COMPAT_ALLOWED_HOSTS` | `live-call.ts` host guard | Explicit comma-separated approved hosts; redirects refused; deployment egress/DNS controls still need verification. |
| `ALLOWED_ORIGINS` | `index.ts`/`cors.ts` | Exact allowed browser origins selected after hosting. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `index.ts` | Platform-injected settings; verify availability for chosen Bolt target. Service-role key is server-only. |

`TYPESAFE_API_KEY` is reserved by the later optional disabled semantic adapter, has no M5 consumer and is not required for live comparisons. No secret values are in source or this inventory. Missing secrets produce `missing_secret` plus names only. Do not enter secrets through chat, code or `VITE_` settings.

## Auth, storage and outside steps

- Email/password sign-up/sign-in/sign-out/session restore/reset/recovery are authored. Choose email confirmation, delivery limits and provider settings in the intended project. Configure Site URL to the eventual app origin/path and redirect allowlist for that path and its `?recovery=1` variant. PKCE recovery must return to the requesting browser; final hosted routing/email delivery must be verified.
- Recovery auto-selects Live; absent config remains a setup state. Session state is scoped to the selected project and owner; switching account unmounts the previous live driver and pauses dispatch.
- Storage buckets, uploads, Realtime, webhooks, scheduled jobs and durable workers: Not required. The browser queue is not a durable worker.
- Real integrations: Supabase-compatible database/auth and Anthropic/OpenAI-compatible one-turn adapters. Explicit offline demo: synthetic recordings and MemoryStore. Semantic/Jev adapter is off and unvalidated.

## Acceptance and receipts

All behavioural outcomes below are **pending/unexecuted**. Exact later commands and cases are in `docs/DEFERRED-VALIDATION.md`.

| Check | Expected evidence | Current outcome |
| --- | --- | --- |
| Install/types/lint/tests/build | One reviewed lockfile; all actual commands with exit codes. | Deferred |
| Edge Deno and package closure | Deno check plus deployed bundle contains core and portable imports; real round trip. | Deferred |
| Isolated migrations | All five ordered files, exact tables/guards/RPCs/grants/RLS verified against tracked baseline. | Deferred |
| Auth/two-user RLS | No-user rejection; A/B private isolation, ownership, sample/run write denial, cap-only RPC. | Deferred |
| Ledger/concurrency | Atomic user/global cap enforcement, same-request replay, one-inflight, no repeated dispatch, conservative uncertainty and audited reconcile. | Deferred |
| Setup/config/provider | No allowlist/cap, cap exceeded/blocked, bad hosts/redirects/missing secrets/config changes refuse with no provider call. | Deferred |
| Capped provider calls | At most one authorized tiny synthetic call per enabled adapter; reservation/usage/settlement exact, tools remain data. | Deferred |
| Billing/check parity | Raw billing retained; unmodelled billing stays unknown liability; where canonical Usage cannot represent declared cache-write breakdown, usage becomes null and cost checks/stats abstain even if ledger can settle exact cost. | Deferred |
| UI/demo/auth | No-network Demo; literal hostile text; explicit Live consent, two-request queue, resume, fresh retry, recovery/owner switch/report parity. | Deferred |
| Cloud/publication | No cloud operation authorized by this document. | Not performed |

## One prompt after a later authorized GitHub import

> Read BOLT-HANDOFF.md and inspect the imported Model-Upgrade Regression Checker source at the owner-selected revision. The intended target is a fresh Bolt Database, but the actual baseline is Unknown. Compare the five ordered migrations, nine tables, nine RPCs, run-task function closure/import map, public environment names, server secret names and auth settings with the imported files. When read-only access is available, inspect existing migration history/schema and report drift without changing it. Source construction is complete for M5; provisioning and all runtime validation are pending. Prepare a concrete setup/validation plan and list remaining owner inputs, including verified provider IDs/prices/billing bounds, live-access grants and deployment cap. Preserve the app, its offline demo and any existing data. Do not create or change cloud resources, apply migrations, deploy functions, enter secrets, enable schedules, or publish. Report cross-directory edge packaging/auth/key compatibility gaps explicitly; do not describe source files, parser checks or unexecuted checks as deployed or working infrastructure.
