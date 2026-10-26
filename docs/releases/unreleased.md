# Expanded dashboard — current main

[README](../../README.md) · [Changelog](../../CHANGELOG.md) · [Dashboard coverage](../dashboard-coverage.md)

Implemented after the [0.2.0 release](0.2.0.md), including
[commit 69043fa](https://github.com/delirious6423/paseo-strata-monitor/commit/69043fa1bf994fb7830b07f36d7ac588658cac0f).
The package/manifest version remains **0.2.0**. These changes are available from `main`; no new release version
or tag is implied by this page.

## New controls

| Area | Additions |
|---|---|
| Autotune | Quick/Thorough, chat/coding, speed/room/explicit reserve, RAM reserve, custom minutes/name, separate answer permissions, measurement-only mode, quiet check and boot timeout |
| Benchmark | All six audited upstream suites, suite-specific controls, standard protocol metadata and distinct nonconforming/incomplete outcomes |
| Model configuration | 30 guided controls, complete advanced JSON, stopped-only atomic saves, conflict detection and private backups |
| Presets | Full details/evidence, rename, redacted export, matching-slot inactive JSON import and effective settings |
| Recovery and usability | Unknown-state Stop/recover, collapsed logs/details even on failure, decimal-friendly numeric drafts and clearer validation |
| Mobile layout | Selected model plus Load/Stop, grouped picker, collapsed task cards, metrics first, larger touch targets/readable inputs and persistent drafts |

The six benchmark suites are `serving-smoke`, `parallel-mixed-v1`, `parallel-overload-v1`,
`parallel-cancel-v1`, `parallel-prefill-cancel-v1` and `standard-v1`. Prompts/token counts stay fixed upstream;
there are no custom prompt-length controls or URL-only managed-match checkbox.

## Important behavior changes

- **Tuning is not an optimality claim.** No winner means no faster setting found within that search. Thorough
  does not enable answer changes; small differences and nonrepeatable settings require separate opt-ins.
- **Measurement only does not apply a change.** Comparison benchmarks are skipped. A previously ready model
  reloads its previous settings; a stopped model stays stopped. Cancellation may require a manual Load.
- **Saved goals must match the slot.** `full` selects speed and `work` selects room; a positive RAM reserve
  also selects room. Resource profile does not allocate memory by itself.
- **Pinned settings are explicit.** User overrides win after preset arguments. Autotune/Re-check refuse pins
  that would invalidate their measurements; restore Default or review advanced JSON. Effective settings show
  those overrides, with engine-side drafting caveats.
- **Status failures are unknown.** Failed runtime/systemd probes are not proof of being stopped. They block
  config writes/Load and offer recovery instead of silently succeeding.
- **Imports are validated before persistence.** Malformed timestamps/nested metadata and unsupported tuning
  settings are rejected; imported recheck claims are cleared. Names are limited to 80 characters.
- **Benchmark inputs match upstream.** Condition labels are lowercase names up to 40 characters. Credential
  fields accept `STRATA_` variable names; empty background lines are removed.
- **Preset bookkeeping can run during benchmarks.** It preserves the Load guard, but queued preset mutations
  can delay Stop by up to four 60-second CLI calls.

## Configuration and backup safety

Saves share the Load/Stop queue, recheck busy/stopped state, compare the original SHA-256, write a private
backup and replace the config atomically. Guided edits preserve unrelated keys/args and remove conflicts for
the edited setting. Recognized credentials, nonloopback bindings and stale drafts are refused. Saving never
loads or restarts a model.

By default, older plugin backups are archived and nothing is deleted. The newest 10 stay adjacent. A separate,
default-off per-save checkbox permits irreversible deletion of older plugin backups, keeping 10 total across
both locations. Consent resets; legacy backups, other configs, symlinks and lookalikes are untouched. The
archive can grow if pruning is never selected.

## Validation and migration

The accepted implementation passed **554 unit tests** with 11 platform-inapplicable skips, **235 integration
checks** across five native OS/architecture targets, **22 isolated upstream contract cases**, and **13 VM browser
checks**. Astra and Opus’s reported findings and follow-ups were addressed. Exact scope, evidence and limitations
are in [Testing](../../TESTING.md); fixtures and isolated functions do not prove real GPU behavior.

No live launch-config/preset migration or real tuning workload was run as part of that acceptance. Existing
model files remain in place. Review pinned overrides and saved-goal/profile matching before your next tune;
config changes still need an explicit Save followed by a later Load.

A separate mobile-UI pass then passed **17/17 VM browser checks**, zero page errors, covering desktop themes,
320px/390px phone layouts, expanded forms and draft retention through Load/Stop. The native backend matrix
was not rerun for those UI-only changes. A compact mobile follow-up then passed **18/18**, adding a 420×912
Air-sized browser viewport. It reduces mobile card padding, gaps and headings while keeping controls at least
44px, inputs 16px and system text scaling enabled; desktop styling is unchanged. Other-platform GUI and native iOS/Android acceptance remain BLOCKED.
The plugin-only reload reported running; the owned browser VM was reset/frozen and released.

The [README screenshots](../../README.md#screenshots) now show that current demo UI with a stopped model;
phone captures include the compact follow-up, with an additional Air-sized view. Original 0.2.0 assets are
retained separately. Empty weights and synthetic fixture data are not real-engine
performance evidence.
