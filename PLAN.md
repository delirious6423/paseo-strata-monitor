# Dashboard controls plan

User request: selectable tuning workload/objective/answer changes, benchmark controls, model configuration,
preset management; logs/details collapsed initially.

- [x] Audit actual CLI/config contracts; expose supported options without invented prompt/length controls.
- [x] Strict tuning/benchmark schemas, RPC/server wiring, forms, option-sensitive confirmation.
- [x] Model configuration: 30 guided controls/full JSON, safe stopped-only atomic saves with backup.
- [x] Preset details/evidence/rename/export/import/effective settings; preserve apply/off/delete/re-check.
- [x] Collapse server logs and job details, including failures.
- [x] Independent adversarial review; fix goal/load-slot mismatch, credential redaction, fresh state and queue races.
- [x] Regression coverage and native disposable VM acceptance on all five OS/architecture targets.
- [x] Real Paseo/browser disposable-VM checks, desktop/phone light/dark and config/preset round trips.
- [x] Update coverage/testing docs; reload only strata-monitor; verify running, no daemon restart.
- [x] Clean owned VM runs; preserve golden images, unrelated work and live models/configs/presets.

- [x] Follow-up: fix every Astra/Opus finding and their recheck findings, including metadata poisoning,
  failed-probe uncertainty/recovery, pinned overrides, upstream CLI contracts, no-save comparisons, guided
  conflicts, credential/name limits, backup retention consent, small UX issues and accurate coverage docs.
- [x] Both reviewer rechecks clear; final native suites 554 unit/235 integration passes, 22 actual-upstream
  contract cases and 13 browser checks. Plugin reloaded and running; VM cleanup verified.

No real inference/tuning/update workload, commit or push. Acceptance evidence/limits: `PROGRESS.md`, `TESTING.md`.
