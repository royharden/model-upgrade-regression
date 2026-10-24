# Deferred validation

Status: M1 source and authored tests only. Dirty Mode prohibits installation, typechecking, linting, tests, builds, application execution, network, browser, database and Docker work. No dependencies or lockfile have been installed/generated. No behavioural test has passed or failed because none has run.

Static syntax gate permitted in this phase (parses stripped modules without linking or executing them):

```powershell
$files = @(Get-ChildItem src,tests -Recurse -Filter *.ts | ForEach-Object FullName)
$files += @('vite.config.ts', 'vitest.config.ts')
node --experimental-vm-modules tools/syntax-check.mjs @files
```

This is a syntax gate only. It does not resolve imports, validate dependency versions, typecheck, exercise Ajv/Zod, run tests or establish runtime correctness. The inherited checker is retained unchanged. TSX will require inspection until later validation.

Run the following only after Dirty Mode closes. Commands assume the inner product repo is the working directory. Later milestones add the app/CLI/backend entrypoints; their commands must wait for those sources too.

| What | Why deferred | Exact later command / steps |
| --- | --- | --- |
| Install exact dependencies and generate one lockfile | Installation/network forbidden | `npm install`; inspect and commit `package-lock.json`; subsequently use `npm ci`. Verify pinned packages and licensing while installing. |
| Type and cross-module API checks | Execution of tooling forbidden | `npm run typecheck` |
| Lint, including React HTML rendering prohibition | Execution forbidden | `npm run lint` |
| All authored tests | Test execution forbidden | `npm test` |
| Focused M1 tests | Test execution forbidden | `npm test -- tests/core/regressdiff/schema.test.ts tests/core/regressdiff/normalise.test.ts tests/core/regressdiff/checks.test.ts` |
| Production bundle | Build forbidden; UI entrypoint arrives in M2 | `npm run build` |
| Portable models mirror | Canonical portable files arrive in M2 | Add/execute a test importing `supabase/functions/run-task/portable/models.json` and validating it with `ModelsSchema`; compare portable `Model`/prices/types against the Zod mirror. |
| Actual cost-jump injector | Benchmark injector arrives in M4 | Add/execute an integration test feeding the real token-recount injector output to `runCheck(cost_budget, ...)`. M1 has the token-recount contract test only. |
| Offline demo | Server/browser prohibited; journey arrives in later milestones | Load the canonical agent-ports skill, claim/check a host port, then `npm run dev -- --port <claimed-port>`; complete PLAN 1.1 with no env and browser network disabled. |
| CLI parity | CLI arrives M3; no execution in this phase | `npm run compare -- --suite fixtures/suite.demo.json --old fixtures/recordings/old.jsonl --new fixtures/recordings/new.jsonl --k 3`; assert printed BLOCK and exit 1. |
| Dev benchmark and frozen held-out run | Eval arrives M4; no execution permitted | `npm run eval`; inspect support inventory and named misses/false alarms, then `npm run eval -- --heldout` exactly once per benchmark/config version. |
| Backend and live validation | Backend arrives M5; no provisioning/network permitted | Later milestones must append the precise Deno, isolated migration, ownership/RLS, budget concurrency, auth/allowlist/cap/base-URL and capped provider-call steps before activation. |

Do not substitute `node --check file.ts` for the static gate: this project's Node 24 environment has accepted malformed TypeScript through that route. Review source/static acceptance separately from deferred behavioural acceptance.

M1 rework 1 adds direct stored-output regressions for unknown stop reasons at `OutputSchema`, `RecordingLineSchema`, `runCheck` and the refusal evaluator, plus preservation cases for recognised reasons, null and refusal phrases. These assertions remain unexecuted because Dirty Mode forbids tests. After Dirty Mode closes, run `npm test -- tests/core/regressdiff/schema.test.ts tests/core/regressdiff/checks.test.ts` to validate this boundary fix.
