# Model-Upgrade Regression Checker

Compare recorded old/new model responses, inspect cited evidence, record human rulings and export one shared migration decision. The React interface and recorded-input CLI call the same pure comparison, policy and report core. Proposed tool calls remain data and are never executed.

**Source construction complete; runtime validation and provisioning pending.** This project has never been installed, typechecked, linted, tested, built, run or provisioned. Dirty Mode allows source authoring, source review and the documented parse-only syntax gate. Authored tests and parser receipts do not establish functioning software or measured results. There is no package lockfile yet, no deployed backend and no remote Git repository. See [deferred validation](docs/DEFERRED-VALIDATION.md) and [limitations](docs/LIMITATIONS.md).

Codex coding agents authored the source; verification was limited to static source review and parse-only checks, with execution deferred.

## Intended journey

The initial Demo path is keyless: bundled synthetic fixtures, an in-memory store, and no network implementation loaded. Choose a suite and k=1,3,5 samples per side, replay recordings, inspect worst-first findings and canonical evidence pointers, then confirm, waive or request a retest with a reason. Reports retain original severity, support status, immutable evidence and the full owner-scoped ruling audit. Both Markdown and JSON exports use the shared report model. Model-supplied HTML, instructions, fake pointers and report-shaped content are displayed as text.

The fixture suite contains 40 authored tasks and 200 authored recording lines per side. Eighteen deterministic check types cover text/JSON/length, tool traces, thinking leaks, refusal/stop reasons, cost and latency. Cell verdicts preserve errors and the fixed denominator. A majority flip can regress; smaller changes can remain within noise. Statistics are diagnostic and never rewrite cell verdicts. Read [check contracts](docs/CHECKS.md), [normalisation](docs/NORMALISATION.md), [verdicts](docs/VERDICTS.md), [pointers](docs/POINTERS.md) and [policy](docs/POLICY.md).

Semantic concerns are a separate `NEEDS_REVIEW` bucket, never deterministic pass/fail cells. The key-token fact baseline checks lexical token presence; the refusal-style baseline shares the versioned phrase/stop-reason inventory. Supported items resolve pending review when confirmed or waived; retest remains pending, and unsupported evidence still forces REVIEW. Generative judge and Jev are disabled typed interfaces: no implementation, provider calls or measured model results. Sixty authored labelled semantic rows per dev/heldout partition support a later deterministic-baseline evaluation. These synthetic labels do not establish entailment, tone understanding or domain accuracy.

Live is separately lazy loaded and requires backend provisioning, authentication, verified model prices/billing bounds, owner live-access grants, global and user caps, server secrets, and explicit paid-call consent. The browser dispatches at most two requests at once; hiding/closing it pauses new dispatch while accepted calls may finish. It is not a durable worker. Stored samples, including errors, are terminal immutable evidence; retesting them requires a new run. Missing-sample retry needs explicit acknowledgement and a fresh reservation. Canonical usage can be null for cache/special billing categories: checks abstain and raw data remains retained, while the actual ledger can independently settle a known bill. Unknown liability retains its reservation. All these runtime behaviors remain unverified.

## Later local activation

These are future steps after Dirty Mode closes; they are not execution receipts. Run from this inner repository. Use Node/npm compatible with the pinned package versions; Node 24 has only been used for stripped-module parsing, and application/runtime compatibility remains unverified.

```powershell
npm install
# Inspect and commit the generated package-lock.json, then use npm ci subsequently.
npm run typecheck
npm run lint
npm test
npm run build
```

Before starting a local server, load the canonical agent-ports skill and claim/check its port. Then use `npm run dev -- --port <claimed-port>` and open Demo without environment configuration. Later compare recordings with:

```powershell
npm run compare -- --suite fixtures/suite.demo.json --old fixtures/recordings/old.jsonl --new fixtures/recordings/new.jsonl --k 3 --format markdown
```

CLI exit: BLOCK is 1; otherwise unresolved deterministic uncertainty or invalid input is 2; otherwise 0. REVIEW is printed and can exit 0. Semantic review alone does not manufacture BLOCK, COULD_NOT_JUDGE or exit 2. Read the verdict rather than treating exit 0 as migration approval.

After validating dependencies/tests, use `npm run eval` for development only. Review class support, all misses/spurious pairs, semantic abstentions, fixture hashes and configuration versions before freezing the configuration. Only then run `npm run eval -- --heldout` exactly once for that benchmark/config identity. A started or failed attempt consumes its key. The canonical `results/heldout-run.log` and persistent reservation remain authoritative even with a different `--out`. Both semantic fixture hashes and baseline versions are bound to the configuration; only the selected partition is evaluated. Results and README marker content are generated solely by actual future evaluation.

## Benchmark evidence

No dev, held-out, semantic, generative-judge or Jev scores have been measured. The author-built benchmark is synthetic and clustered by base task; descriptive Wilson intervals and generated support gaps must accompany any future results. It does not measure real-world drift or live spend. No superiority or release acceptance is claimed. [Results methodology](results/README.md) describes the methods and once-per-version/config guard.

<!-- benchmark-results:start -->

Not yet measured. Development, held-out and deterministic semantic baseline results are pending. Generative judge and Jev: not evaluated (disabled).

<!-- benchmark-results:end -->

## Infrastructure handoff

[BOLT-HANDOFF.md](BOLT-HANDOFF.md) is the sole provisioning inventory. It names the five ordered migrations, nine tables/RPCs, `run-task` edge closure, auth/RLS, public configuration and server secret names. The intended fresh target is Bolt Database; the actual applied baseline is Unknown. The prepared prompt is inspection-only. No resources, migrations, functions, auth settings, secrets or hosting have been provisioned here. Deno packaging, cross-directory imports, two-user RLS, concurrency, actual provider billing and hosted round trips all remain open in the deferred ledger.

License: [MIT](LICENSE). [VENDORED.md](VENDORED.md) records vendored provenance.
