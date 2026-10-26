# Dashboard controls plan

## Mobile UX pass

- [x] Inspect current phone evidence and separate primary actions from advanced tools.
- [x] Collapsed model picker/task sections, larger touch targets and readable form inputs.
- [x] Initial mobile VM regression: 17/17 checks; compact Air follow-up: 18/18 with 320/390/420px geometry,
  workflows, draft retention and themes. Mobile controls ≥44px, inputs 16px; desktop unchanged.
- [x] Inspect screenshots and record platform gaps/cleanup. No live model actions.
- [x] Reload only strata-monitor; verified running. No daemon restart or commit/push.


## Documentation refresh

- [x] Move the screenshot to the README top; organize install, features, workflows, safety and guide links.
- [x] Refresh every Markdown guide; separate current main changes from historical 0.2.0 behavior.
- [x] Add operations/current-change guides and correct the 30-field inventory and benchmark contracts.
- [x] Validate all 10 Markdown files: 79 link/image references, heading anchors, eight external URLs (HTTP 200),
  five current PNG captures and independent source-fact review. TypeScript and diff checks pass.
- [x] Recapture current desktop/phone light/dark and Air screenshots in a disposable VM; 18/18 checks pass,
  replace README images, update evidence and verify owned VM frozen/lease released.
- Preserve concurrent mobile-UI work and its separate acceptance evidence; do not imply backend tests cover it.

## Expanded dashboard implementation

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

No real inference/tuning/update workload was run for the expanded-dashboard acceptance. Implementation
published in [commit 69043fa](https://github.com/delirious6423/paseo-strata-monitor/commit/69043fa1bf994fb7830b07f36d7ac588658cac0f).
Documentation/mobile-UI follow-ups are separate from that baseline; the user subsequently authorized
publishing them together. Their latest acceptance and screenshot evidence are recorded above.
Acceptance evidence/limits: [Progress](PROGRESS.md), [Testing](TESTING.md).
