# Dashboard coverage

[README](../README.md) · [Operations](operations.md) · [Current changes](releases/unreleased.md) ·
[Testing](../TESTING.md)

This is the expanded dashboard on `main`, after the 0.2.0 tag. Contracts were checked against the installed
Gyro-L Strata runtime during the 2026-10-26 acceptance. Other Strata versions can differ. The plugin exposes
workload/configuration controls, not every CLI plumbing switch or every engine-specific option.

## Layout and mobile behavior

The default screen shows the selected model and Load/Stop; Change model opens a grouped picker. Collapsed
task cards separate tuning/benchmarks, configuration/presets, activity/updates and model details/discovery.
Live metrics lead when online; hardware/history is optional. Running jobs, Cancel and action errors remain
visible. Mounted forms retain drafts across card closing and online/offline transitions.

The compact mobile layout keeps primary controls at least 44px tall, editable inputs at 16px and system text
scaling enabled. The latest 18-check VM browser run covers 320px/390px/420px phone viewports and desktop themes.
The Air-sized fixture measures a 293px model card and 78px collapsed task cards; desktop styling is unchanged.
These are browser checks, not native mobile or other-OS GUI acceptance.

## Tuning

| Control | Supported values / behavior |
|---|---|
| Search depth | Quick or Thorough; default budgets 20 minutes / two hours |
| Workload | Chat or coding |
| Objective | Speed, room, or explicit graphics-memory reserve |
| Reserve | 0–1,048,576 MiB; only used for the explicit reserve objective |
| System RAM reserve | 0–50%; a positive value also selects the room slot |
| Answer permissions | Separate small-difference and nonrepeatable opt-ins, both initially off |
| Time budget | Optional positive minutes, up to 1,440; decimals allowed |
| Preset name | Optional, up to 80 characters; blank lets Strata name it |
| Save | On by default; off is measurement only, with no saved/applied preset or comparison benchmarks |
| Quiet check | On by default; may be disabled with a warning about competing workloads |
| Boot timeout | 1–86,400 seconds; default 900 |

Saved goals must match the model’s resource-profile slot: `full` means speed, `work` means room. The profile
itself reserves no memory. Measurement-only runs can explore another goal. Pinned candidate flags in raw or
captured user overrides cause Autotune/Re-check to refuse before disrupting the model.

Results show scope, trial/candidate counts and skipped reasons when upstream provides them. A saved tune of
a previously ready model gets warmup/repeated before/after speed checks. No winner is not proof of optimality.
Full interactive trial charts and an arbitrary job-history browser are not implemented.

## Benchmarks

The six suites are:

| Suite | Purpose |
|---|---|
| `serving-smoke` | Default serving smoke check |
| `parallel-mixed-v1` | Mixed parallel workload |
| `parallel-overload-v1` | Deliberate overload/queue stress |
| `parallel-cancel-v1` | Parallel cancellation behavior |
| `parallel-prefill-cancel-v1` | Cancellation during prefill |
| `standard-v1` | Longer fixed protocol with declared metadata |

Serving suites expose concurrency 1–16 (1–64 for overload), repeats 1–5, request timeout 1–600 seconds,
a lowercase condition name matching `[a-z][a-z0-9_-]{0,39}`, and credential environment-variable names.
Credential names must match `STRATA_[A-Z0-9_]+`; no secret-value field is provided.

Standard exposes optional concurrency, default/custom track, track notes, model/source/tokenizer revisions,
quantization, custom pack, background programs, build options and optional model-hash skipping. Empty background
lines are ignored; skipping the hash marks protocol nonconformance. Standard fixes its workload/repeats/timeouts
upstream and does not receive incompatible serving flags. Nonconforming/incomplete results are distinguished
from failed requests.

The runner uses the loaded server URL. A managed-profile match switch is intentionally absent because it
requires a saved `--profile`, which the URL-only runner does not supply. Prompts and token counts are fixed by
each upstream suite; custom prompt-length controls and a full report-comparison UI are not implemented.

Source contracts: [option schemas and argv](../shared/options.ts).

## Model configuration

There are **30 guided controls**, plus complete advanced JSON:

| Group | Guided controls |
|---|---|
| Context and memory (7) | Context tokens, KV format, expert-cache slots, VRAM reserve, resource profile, elastic cache, elastic segment size |
| Drafting and CPU (6) | Drafting strategy, MTP draft layer, speculative window, confidence floor, CPU workers, CPU affinity |
| GPU and vision (5) | GPU selection, layer split, GPU order, skip split if one GPU fits, vision JSON |
| Serving (12) | Parallel requests, thinking budget, fit answer to context, Anthropic thinking, effort position, sampling JSON, aliases, lazy load, idle unload, engine silence timeout, API prompt monitoring, browser-open preference |

Prefill/chunking and less-common engine arguments can be edited through advanced JSON; they are not additional
guided controls. Availability and actual engine meaning depend on the model/runtime. Guided edits preserve
unrelated keys and argument groups, but remove conflicting arguments for the explicitly edited setting.

Saving requires a fresh known stopped/failed state for every detected model, no detected foreign server,
no busy tool and the original file digest. Unknown status, stale drafts, recognized credential-bearing configs
and nonloopback binds are refused. Limits: 256 KiB, 40 nesting levels. Unknown advanced fields are preserved,
not exhaustively engine-validated. Save creates a backup, replaces atomically and never starts the model.

Backups archive without deletion by default. A separate, default-off per-save checkbox permits permanent
pruning to 10 total plugin backups across adjacent/archive locations. See [backup policy](operations.md#configuration-backups-and-storage).

Source field definitions: [model config contract](../shared/model-config.ts).

## Presets and other tools

| Area | Available | Not included / caveats |
|---|---|---|
| Presets | Status, apply/off/undo/delete/re-check, details/evidence, rename, redacted export, pasted JSON import, effective settings | Supported tuning args/env/request values only; matching slot; inactive import; no automatic restart |
| Import safety | Metadata types/timestamps validated, foreign recheck claims cleared, bounded private temp files cleaned | 512 KiB, 24 nesting levels; unsupported settings rejected rather than silently stripped |
| Effective tuning | Preset arguments followed by actual raw user overrides; pinned values reported | Not live process inspection; engine-side drafting and other config transforms can still alter launch |
| Updates | Signed-feed engine/control install, progress, engine undo | Custom executables/forks are not replaced by component updates |
| Model installation | Discover existing prepared run configs and services | No weight download, packing or install workflow |
| Logs/history | Collapsed server log and job details, latest three jobs displayed, last 20 retained | No full log search or full history navigation |
| Idle stop | Off, 15/30/60/120 minutes | No arbitrary UI timeout; unreadable/busy metrics prevent stopping |

Preset mutations share Load/Stop’s queue and reserve busy state immediately. Bookkeeping is allowed during
benchmarks without releasing their Load guard; a mutation can delay Stop by up to four 60-second CLI calls.

## Boundaries

- Model/option changes invalidate disruptive-operation confirmation.
- Config screening and export redaction recognize common secrets, not arbitrary secrets disguised as neutral text.
- Discovery, status probes and process ownership are not exhaustive GPU-use detection.
- Before/after timing is an uncontrolled sanity check, not a randomized performance claim.
- Native fixture suites and VM browser checks do not prove real-engine/GPU behavior or non-Linux desktop GUI behavior.

The accepted expansion did not change live Gyro-L launch configs or start a real tune/benchmark workload.
See [Testing](../TESTING.md) for evidence and untested areas, and [Operations](operations.md) for recovery,
credentials, cancellation, storage and update limits.
