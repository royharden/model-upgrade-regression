# Benchmark evidence

Construction status: not yet measured. At source construction no dev or held-out benchmark had run. The generated block below records the current measurement state once a future evaluation runs. Source and authored tests exist under Dirty Mode; syntax parsing does not establish behavior, types, metrics, or pointer integrity at runtime.

After Dirty Mode closes, run `npm run eval` for dev first. Review support and every miss/spurious pair before the single frozen held-out run `npm run eval -- --heldout`. A started or failed held-out attempt consumes its benchmark-version/config key. Preserve its persistent reservation and append-only `results/heldout-run.log`. Changing `--out` cannot bypass that canonical guard.

`results.md`, `results.jsonl`, the generated manifest and held-out log/reservations are created only by a future evaluation. The generated block below and the root README block, when present, are replaced only with those actual results. No hand-entered benchmark numbers belong here. Intervals are descriptive Wilson 95%; variants are clustered by base task. This author-built benchmark measures wiring and false-alarm discipline rather than real-world drift. Semantic baseline measurements are pending M6; generative judge and Jev remain disabled and not evaluated.

Methods share the same recorded rows at k=1 and k=5. Exact diff compares the complete normalized output, including usage, latency and the original-order tool trace; its check attribution is N/A. Model-matrix flags any new-side check failure, including pre-existing failures. The paired checker calls the production comparison core. The no-normalisation ablation instead supplies the stored pre-normalisation views to that same core. The no-noise-floor ablation changes only WITHIN_NOISE cells: decreases become REGRESSED and increases become IMPROVED. Errors, majority flips and PRE_EXISTING precedence remain unchanged. Source recorded-error exclusions are named separately from method COULD_NOT_JUDGE cells; none silently reduce a generated variant denominator.

<!-- benchmark-results:start -->

Not yet measured. Development and held-out results are pending.

<!-- benchmark-results:end -->
