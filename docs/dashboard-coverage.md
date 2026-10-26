# Dashboard coverage

Source audit, 2026-10-26, against the installed Gyro-L Strata CLI/config contracts. The dashboard exposes
workload controls, not every CLI plumbing switch. Option panels, logs and job details start collapsed.

| Area | Selectable dashboard controls | Deliberate exclusions |
|---|---|---|
| Autotune | Quick/Thorough, chat/coding, speed/room/explicit VRAM reserve, RAM reserve %, custom minutes, preset name, save/measurement-only, quiet check, boot timeout | CLI/config paths, lock/status/output destinations; upstream search policy remains in force |
| Answer changes | Separate small-difference and nonrepeatable opt-ins, both off initially; warning when enabled | No claim that Thorough permits answer changes by itself |
| Tuning results | Scope, candidate/trial counts, skipped reasons, before/after speed; explicit measurement-only result | Full interactive trial charts and arbitrary job-history navigation |
| Benchmark | serving-smoke, parallel-mixed-v1, parallel-overload-v1, parallel-cancel-v1, parallel-prefill-cancel-v1, standard-v1; serving concurrency/repeats/timeout/condition label/STRATA_ credential env names; standard track/revisions/quantization/background/build metadata | Suite prompts/token counts are fixed upstream; no invented prompt-length knobs or full report comparison UI |
| Model configuration | 30 guided controls: context/KV, speculative window, prefill/chunking, expert cache/placement, CPU workers/affinity, batching, CUDA devices, vision, resource profile; full advanced JSON | Recognized credential-bearing documents and nonloopback binds refused; unknown advanced fields are preserved, not exhaustively engine-validated |
| Presets | Status/apply/off/undo/delete/re-check; custom tune name; inspect/evidence/rename/export; pasted matching-slot JSON import; effective settings for next start | Imports allow supported tuning args/env/request fields only; unsupported settings rejected; no automatic apply on import or save |
| Model installation | Discover existing configs/services, including prepared Gyro-L | Download/pack/install workflow remains external; a raw GGUF alone is not runnable |
| Updates | Signed-feed engine/control components, undo | Custom engine source builds are separate; Gyro-L's dedicated fork is not updated by these controls |
| History/logs | Latest 3 jobs; last log lines; collapsed even after failure | Full history browser and full log search |
| Idle stop | Off, 15/30/60/120 minutes | Arbitrary idle timeout |

## Safety boundaries

- Changing model/options invalidates disruptive-operation confirmation.
- A saved speed/room goal must match the model's load-time resource profile. Choose Full speed/Leave room in
  Model configuration, or run measurement-only; the dashboard refuses a saved mismatch before any workload.
- Config writes share Load/Stop's lock, require a fresh known stopped/failed-state check, compare the original
  SHA-256, back up the old file and replace atomically. Failed status probes become unknown, block saves/loads,
  and offer Stop/recover. Guided edits remove conflicting arguments only for the edited controls.
- Backups: newest 10 plugin-namespaced files stay adjacent by default; older ones are archived without deletion.
  A default-off per-save checkbox explicitly permits deleting older plugin backups, keeping 10 total across
  both locations. Legacy backups, other configs, symlinks and lookalikes are never pruned.
- Preset mutations reserve the tool-busy state immediately, then wait behind already-admitted Load/Stop work.
  Bookkeeping remains available during a benchmark without releasing its Load guard. A preset mutation can
  delay Stop for up to four 60-second CLI calls; the expanded preset panel warns about this queue.
- Autotune and Re-check refuse pinned tunable user overrides rather than measuring shadowed candidates.
  Effective tuning merges actual user_args after preset overlays and reports those pins. Resource profile only
  selects a preset slot; it does not itself reserve memory. Measurement-only tuning restores the previous model
  without unnecessary before/after benchmarks or a misleading speed-change claim.
- Config screening and export redaction recognize common credentials, not arbitrary secrets disguised as
  neutral text. Review advanced JSON and exports before use/sharing. Local backups contain the previous file.
- Before/after timing is an uncontrolled sanity check, not a randomized performance claim.

No live Gyro-L launch configuration was changed and no real tuning/benchmark workload was started for this expansion.
Disposable acceptance uses real Paseo with fake CLI/server fixtures, not GPU inference. See [testing](../TESTING.md).
