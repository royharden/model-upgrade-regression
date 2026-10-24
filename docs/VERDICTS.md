# Verdict rule v1 and comparison contracts

`cellVerdict(oldStatuses, newStatuses, k)` accepts exactly k statuses per side, with k in 1,3,5. It never drops errors to shrink the denominator. `VERDICT_RULE_VERSION` is `verdict-rule-v1`.

Let P_old/P_new be pass counts, majority mean `2P > k`, and T = `max(min(P_old, k-P_old), 1)`. Apply the following total, ordered rules:

1. Any error on either side: COULD_NOT_JUDGE, retaining per-side pass/fail/error counts and error_counts.
2. Old strict majority passing, new not: REGRESSED.
3. Old not passing by majority, new passing by majority: IMPROVED.
4. Both majority passing: old-minus-new > T means REGRESSED; new-minus-old > T means IMPROVED; equal counts mean UNCHANGED; otherwise WITHIN_NOISE. Equal counts below k have an instability note.
5. Both majorities failing: PRE_EXISTING, even if failure counts changed.

The majority-flip rule deliberately departs from a threshold-only rule. Thus 2/3→1/3 regresses; 3/3→2/3 is within noise; 5/5→3/5 regresses; 4/5→3/5 is within noise. At k=1 the bright-line pass/fail table results. NEEDS_REVIEW is reserved for the later semantic slot and never produced by deterministic checks.

For a COULD_NOT_JUDGE cell, `provisional` is information only. Use sample indices judged on **both** sides, then apply the same majority/floor logic to that paired subset; its denominator may differ from k and is displayed as paired_judged. With no complete judged pairs, provisional verdict is null. This paired-subset convention keeps denominators equal for the diagnostic; the authoritative verdict stays COULD_NOT_JUDGE. Policy, statistics and benchmark must never treat provisional as the cell verdict.

`pairSamples` validates identities, duplicates, sample hashes and sample indices; it orders samples by 1..k and represents missing samples as recorded `missing_sample` errors. Samples 4/5 may be present when comparing at k=3; they do not enter that cell. `makeSample` hashes the whole output or `error:` plus the recorded error message. Raw data never supplies offsets.

`compare({suite,samples,run_id,args,owner_id,rulings?,manifest?})` validates suite/run args, builds an in-memory manifest from actual models.json when absent, judges each sample/check, and derives cells/findings. A supplied manifest must match run, suite, model IDs, k and current engine versions. Prices are frozen in that manifest. Mock cost checks use nonzero synthetic check prices; mock spend remains zero. The comparison accepts no provider or tool executor.

Finding id is SHA-256 of canonical task_id, check_id, check-config hash, ordered old and new output-hash vectors, normalisation version and verdict-rule version. It excludes run/model aliases and owner; replay additionally filters by owner. Because output hashes include original tool order, even an independent order-only trace change changes the finding identity. A changed sample, check or engine version orphans earlier rulings; those events remain in the audit.

`replayRulings(owner_id, findingIds, events)` validates reason and event identity, orders by timestamp and id for deterministic ties, and returns effective events, orphan events and full owner-scoped audit. Tombstones target a prior event with the same owner/finding. Active tombstones supersede their targets; tombstoning a tombstone restores the earlier target. The newest remaining non-tombstone event wins. Confirm, waive and retest all require a reason. Cross-run identical evidence can replay; foreign-owner events cannot replay. Ruling replay changes no evidence or original severity; waived findings remain listed in the same position. Later policy applies the waiver rules.

`sortFindings` accepts optional block-causing finding IDs. Those lead, followed by REGRESSED (always-blocking types first), COULD_NOT_JUDGE, unresolved retest, WITHIN_NOISE, PRE_EXISTING and IMPROVED. Retest never demotes a more severe original verdict. Regression families then task/check IDs provide deterministic ties. M3 adds unsupported severity and policy-aware blocking; M6 adds semantic NEEDS_REVIEW.

`MemoryStore` keeps immutable suites, frozen run manifests, insert-only samples and ruling events. Reads return copies. It stores no cells, findings or reports. Edited suites need a new suite id. The mock provider only replays recordings for exact task configurations; a custom task without exact recordings becomes an error rather than borrowing unrelated answers. `runDemo` loads bundled text imports, replays into the store and compares stored samples; no external connection is involved. The Store port accepts synchronous or asynchronous adapters; MemoryStore is synchronous.

Authored tests include every named vector, an exhaustive pass/error-count grid for k=1/3/5, missing/duplicate/tampered samples, identity changes including original tool order, ruling replay/orphans/tombstones, immutable storage, model mirror/estimate checks, and the complete recorded demo trace at k=3/5. No test has been executed in Dirty Mode. Suite policy, resolver-backed pointers, statistics and reports remain M3 scope; semantic concerns remain M6 scope.
