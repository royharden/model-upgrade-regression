# Independently authored demonstration recordings

Source/license: synthetic text and tool proposals authored for this project on 2026-10-24; MIT as in the repository LICENSE. There are 40 task definitions, five old and five new samples per task (200 lines per side). No provider was called, no tool was executed, and no benchmark injector produced these files. Old and new responses were authored in separate per-task response tables, then serialised as fixture source. Repeated exact answers and empty tool-only text are intentional. No authoring script is imported by runtime or benchmark code.

These plants exercise the wiring and false-alarm discipline of author-built cases. They establish no real-world detection rate. All expected values below are authored expectations; tests have not been executed in Dirty Mode.

All tasks have check id `main`. Unless stated otherwise, a row applies to samples **1–5** on both sides, with old/new pass counts either k/k or k/0 or 0/k as indicated. Thus its expected verdict is the same at k=1,3,5. Every change/control is named here.

| Task | Authored new-side change/control | Old → new pass counts | Expected cell |
| --- | --- | --- | --- |
| fmt.json-order | Benign JSON key reorder: old raw a,z; new raw z,a. Stored text is the same canonical JSON. | k → k | UNCHANGED; no finding |
| fmt.required-field | Required `code` field dropped; status remains. | k → 0 | REGRESSED (`json_schema`) |
| fmt.bullets | Benign glyph changes: samples 1/4 use •, 2 uses *, 3 uses numbered dots, 5 numbered parentheses. Old uses hyphens. Text glyphs stay distinct. | k → k | UNCHANGED; no finding |
| fmt.trailing | Benign trailing newline exists in new raw text only; stored answer remains Ready. | k → k | UNCHANGED; no finding |
| fmt.prefix | RESULT: prefix replaced by Answer:. | k → 0 | REGRESSED (`starts_with`) |
| fmt.regex | Valid three-digit IDs changed from 12x to 22x. | k → k | UNCHANGED |
| fmt.json-valid | Valid JSON object retained. | k → k | UNCHANGED |
| fmt.exact-improved | Old mixed/lowercase Ready replaced by exact READY. | 0 → k | IMPROVED (`equals`) |
| con.thinking | New text contains configured think/thinking tags (different tags across samples); separate thinking remains present. | k → 0 | REGRESSED (`thinking_leak`) |
| con.banned | New text contains secret, uppercase in sample 2. | k → 0 | REGRESSED (`no_banned_words`) |
| con.contains | Explicit consent replaced by permission/choice. | k → 0 | REGRESSED (`contains`) |
| con.preexisting | Neither side meets APPROVED: prefix; both independently worded as pending. Already-failing control. | 0 → 0 | PRE_EXISTING |
| con.error | **Old sample 2 only** is `synthetic_recorded_provider_error`, with null output. All other old and all new answers include ready. Exactly one check on this task. | k=3: 2 pass + 1 error → 3; k=5: 4 pass + 1 error → 5 | COULD_NOT_JUDGE at k=3/5; UNCHANGED at k=1. Exclude this base task from planted benchmark variants. |
| con.cost | New reported output tokens 1000/1100/900/1050/950 versus old 100/105/95/102/98. Synthetic check price breaches USD .001; mock spend stays zero. | k → 0 | REGRESSED (`cost_budget`) |
| con.latency | New 900/950/920/980/940 ms versus old 190/220/210/230/200 ms; above check's 500 ms cap. | k → 0 | REGRESSED (`latency_budget`) |
| con.stop | New recorded stop reason max_tokens versus old end_turn. | k → 0 | REGRESSED (`stop_reason`) |
| tool.forbidden | Old proposes search; new proposes forbidden erase(record_id=demo-42). | k → 0 | REGRESSED (`tool_forbidden`, always-blocking) |
| tool.args | Proposed transfer amount changed from 10 to 100 USD. Calls remain inert data. | k → 0 | REGRESSED (`tool_args`) |
| tool.order | New original trace save,lookup replaces required lookup,save. Task is dependent. | k → 0 | REGRESSED (`tool_order`, always-blocking) |
| tool.independent | Benign original trace changes lookup,search → search,lookup; independent sorted tool_calls are identical. | k → k | UNCHANGED; no finding |
| tool.required | Required search call removed; new replies in prose. | k → 0 | REGRESSED (`tool_called`) |
| tool.schema | Different search-query strings satisfy the same argument schema. | k → k | UNCHANGED |
| tool.duplicate | Both sides retain two same-name search occurrences in this dependent task; query text changes. | k → k | UNCHANGED |
| tool.preexisting | Both sides already propose forbidden erase; record_id changes old-demo → new-demo. | 0 → 0 | PRE_EXISTING hazard |
| ref.safe-answer | Safe houseplant request gains explicit refusal phrases. | k → 0 | REGRESSED (`refusal`) |
| ref.safe-normal | Friendly greetings paraphrased; both answer. | k → k | UNCHANGED |
| ref.safe-phrase | Old inappropriate refusal on safe rainbow request replaced by answers. | 0 → k | IMPROVED (`refusal`) |
| ref.safe-stop | Both give Earth with known end_turn reason. | k → k | UNCHANGED |
| ref.must-refuse | Both refuse a synthetic must-refuse request with recognised phrases. | k → k | UNCHANGED |
| ref.must-stop | Old reason refusal replaced by answered prose/end_turn on must-refuse request. | k → 0 | REGRESSED (`refusal`) |
| len.noise | **New sample 3 only** exceeds ten chars; samples 1/2/4/5 remain under the cap. | k=3: 3 → 2; k=5: 5 → 4 | WITHIN_NOISE at k=3/5; UNCHANGED at k=1 |
| len.bound | New answers exceed twelve code points. | k → 0 | REGRESSED (`length`) |
| len.words | New three-word paraphrases remain within two-to-four-word bound. | k → k | UNCHANGED |
| len.improved | Old over-eight-character replies replaced by short answers. | 0 → k | IMPROVED (`length`) |
| sem.fact-loss | Paris omitted while nonempty answer check still passes. | k → k | UNCHANGED deterministically; key-token NEEDS_REVIEW arrives with semantic slot in M6 |
| sem.paraphrase | Benign fact paraphrase retains Mercury, closest, Sun tokens. | k → k | UNCHANGED; intended semantic control |
| sem.number | All answers retain 12 months. | k → k | UNCHANGED |
| sem.tone | Neutral acknowledgements become enthusiastic; received remains. | k → k | UNCHANGED; named deterministic tone miss |
| sem.fact-keep | Oxygen fact retained in different wording. | k → k | UNCHANGED |
| sem.fact-improved | Old unnamed ringed planet becomes explicit Saturn. | 0 → k | IMPROVED (`contains`) |

All ordinary outputs also carry independently authored old/new usage and latency spreads. Default old input/output tokens are 96/40, 110/45, 104/43, 101/39, 108/44; default new are 102/42, 108/47, 109/45, 105/43, 111/46. Default latency changes old 110/125/118/130/122 → new 120/135/128/140/132 ms, a benign jitter below the latency cap; special cost/latency rows override these. These measurements intentionally make exact-output diffs sensitive even where checks stay satisfied. Raw carries original text for the JSON-key/trailing-newline controls; all check evidence addresses stored normalised outputs.

Category inventory: 8 format, 8 constraint, 8 tool_call, 6 refusal (4 expected answered; 2 expected refused), 4 length, 6 semantic. Every semantic task declares required_facts. All 18 deterministic check types occur. A stored raw response is never a pointer target. M3 adds resolver-backed finding pointers and suite policy; M6 adds semantic findings. Neither capability is claimed for M2.
