# Progress

## Publication approved (2026-10-26)

User: “push to github.” Publication scope: compact mobile UI, its VM regressions, refreshed documentation
and five current screenshots. Pre-push TypeScript/diff checks pass; local HEAD and origin/main were aligned.
Latest disposable-VM run passed 18/18 with zero page errors; owned VM is FROZEN and its lease released.
Earlier no-push notes below describe their checkpoints, not this later authorization.

## Fresh screenshot capture (2026-10-26)

User: “Take updated screenshot and update.” Ran `bash tests/vm/dashboard-ui.sh` against the current tree:
**18/18 PASS**, zero page errors. Inspected desktop/Air captures and replaced all five README dashboard images.
Evidence: `/mnt/data4tb/strata-dashboard-tests/20261026-120905/`; `/tmp/strata-screenshot-refresh.log`.
Updated README caption/evidence and TESTING provenance. No application code changed or live model touched.
Cleanup independently checked: owned `df-warm-0033aacf-1` FROZEN, lease absent; controller exited.
No commit/push for this refresh.

## iPhone Air density follow-up (2026-10-26)

User screenshot feedback: previous mobile pass was too large. Mobile-only card padding 16→12,
internal gaps 16→8, section gaps 16→12, model title 18→16, task titles 16→14 and hints 14→12.
Primary controls remain at least 44px; editable fields remain 16px. Desktop layout unchanged;
system text scaling stays enabled. Expanded/collapsed state and drafts still preserved.

`bash tests/vm/dashboard-ui.sh`: **18/18 PASS**, zero browser errors, including 420×912 Air-sized
viewport and existing 320/390/1280px checks. Air fixture model card 293px, collapsed task 78px.
Evidence `/mnt/data4tb/strata-dashboard-tests/20261026-120431/` (phone-air.png inspected);
log `/tmp/strata-compact-air.log`. TypeScript/diff PASS. Controller exited; owned VM reset/frozen,
lease released. Only strata-monitor reloaded, response running. Native iPhone acceptance still
not performed; prior native platform gaps apply. No real model operations, commit or push.

## Documentation refresh (2026-10-26)

- README starts with a current VM screenshot and is reorganized around install, features, use, safety and guides.
- Added current desktop/phone light/dark demo assets plus a 420×912 Air-sized view; refreshed phone captures
  from the 18-check compact follow-up. Preserved original 0.2.0 images and labeled provenance.
- Updated every Markdown document, including current-change notes and a new operations/recovery/storage guide.
  Corrected the exact 30-field inventory, benchmark contracts, backup policy and historical/current acceptance labels.
- Independent source-fact review found no implementation-contract blockers; its test-count, asset-caption and
  task-navigation wording corrections were applied.
- PASS: all 10 Markdown files / 79 link-image references and heading anchors; all eight unique external URLs
  return HTTP 200. Five PNGs match the latest VM source bytes (desktop 1280×900, phone 390×844, Air-sized 420×912).
  `npm run typecheck` and `git diff --check` pass. No app workload started for these documentation edits.
- Preserved and documented the separately accepted mobile-UI follow-up. The earlier expanded-dashboard
  implementation was published as
  [commit 69043fa](https://github.com/delirious6423/paseo-strata-monitor/commit/69043fa1bf994fb7830b07f36d7ac588658cac0f).

## Mobile UX pass (2026-10-26)

- Selected model and Load/Stop replace the always-expanded model inventory. Change model opens a
  grouped picker and closes on selection. Unknown runtime state now says unknown, not stopped.
- Separate collapsed task cards: tuning/benchmarks, configuration/presets, activity/updates, and
  model details/discovery. Active jobs/Cancel and action errors remain outside collapsed sections.
- Live speed appears first when online; hardware/history is optional. Bounded desktop width,
  larger spacing, 48px primary/form actions, and 16px editable inputs for mobile.
- Task sections retain mounted form drafts. VM regression exposed and fixed the old online/offline
  screen remount that reset tuning choices and expanded panels when loading/stopping.
- No dependencies or backend changes. Concurrent README edits are another session's work; preserved.
- Final acceptance: **17/17 PASS**, real Paseo + Brave in the owned Linux x64 VM, including online
  320px geometry/state retention, 390px light/dark, desktop themes, expanded forms, existing workflows;
  zero browser page errors. `npm run typecheck` and `git diff --check` PASS.
- Evidence: `/mnt/data4tb/strata-dashboard-tests/20261026-115258/`; controller log
  `/tmp/strata-mobile-ui-verified.log`. Inspected desktop, phone and online narrow-phone captures.
- Earlier added-test failures were assumptions about RN Web aria output and the fixture's generating
  (not idle) state; final assertions check retained mode text and real online metrics.
- Cleanup verified: controller exited, df-warm-0033aacf-1 reset/frozen, lease absent. Only strata-monitor
  reloaded; response running. No daemon restart, real model actions, commit or push.
- Native iOS/Android and other desktop OS/architecture UI acceptance remain BLOCKED (no configured
  native UI harness used here); Linux browser viewport checks do not establish native acceptance.


## 2026-10-26: Astra/Opus findings fixed; plugin reloaded

User: “Fix every listed issue.” All original findings and follow-up findings addressed. Earlier blanket
safety clearance was superseded by these deeper upstream-contract reviews.

### Fixes

- Preset imports validate upstream-consumed timestamps/nested metadata before CLI/temp writes; reject malformed
  data and reset foreign recheck claims. Rename/tune names capped at 80 characters.
- Failed runtime/systemd status probes become unknown, never stopped. Config Save fails closed; unknown
  models expose Stop/recover and Load rejects explicitly instead of returning successful no-op.
- Autotune rejects the union of raw/captured pinned candidate overrides. Re-check includes the selected
  preset's flags and validates before stopping a model. Effective tuning merges actual raw user_args after
  saved overlays. Spec/worker help explains pinning and restoring Default.
- Guided segment/layer/split/vision edits remove conflicting arguments, preserve unrelated values, and handle
  duplicate/equals forms and elastic enablement dependency. Resource-profile help accurately describes slot selection.
- Removed URL-only managed-match benchmark option. Validate condition regex and STRATA_ credential env names;
  filter empty background entries. Distinguish nonconforming/partial standard protocol results from failed requests.
- Measurement-only tuning skips before/after benchmarks and misleading speed deltas, restoring previous ready state.
- Preset bookkeeping works during benchmarks without releasing the Load guard. Queue/Stop delay documented;
  busy-message grammar corrected. Numeric fields preserve decimal/invalid drafts without showing NaN.
- Newest 10 plugin-namespaced backups remain adjacent by default; older ones archive without deletion.
  Default-off per-save consent permits pruning to 10 total across both directories. Exact own namespace,
  regular-file/identity checks; preserve legacy/other files/symlinks. Failures report warning after successful save.
- Corrected benchmark-suite coverage docs. Fake CLI rejects invalid contracts; persistent upstream AST check
  tests actual validators and argument precedence without importing/launching the application.

### Outside checks

| Native disposable VM | Unit tests | Integration |
|---|---|---|
| Linux x64 | 113 PASS | 47/47 PASS |
| Linux ARM64 | 113 PASS | 47/47 PASS |
| Windows x64 | 110 PASS, 3 Linux-only skips | 47/47 PASS |
| Windows ARM64 | 110 PASS, 3 Linux-only skips | 47/47 PASS |
| macOS ARM64 | 108 PASS, 5 systemd skips | 47/47 PASS |

Total: **554 unit passes, 11 platform-inapplicable skips, 235 integration passes**. Frozen native-source
manifest verified by ARM runner. Final two field-help strings changed after native suites; final browser,
typecheck and upstream checks include those copy-only changes. Source/test behavior otherwise frozen.

- Actual installed upstream pure AST contract: **22/22 PASS**; no real app/GPU/live-state changes.
- Real Paseo + Brave both in disposable Linux VM: **13/13 PASS**, no page errors, including invalid numeric
  drafts/decimal entry, condition/env validation, removed match toggle, backup-deletion consent default/reset,
  config save without restart, preset round trip, desktop/phone light/dark and collapsed defaults.
- UI evidence: `/mnt/data4tb/strata-dashboard-tests/20261026-113500/`.
- ARM evidence: `/mnt/data4tb/strata-paseo-arm-acceptance-20261026/final/` (logs, manifests, architecture,
  post-run inventories). x64 logs and exact commands in `TESTING.md`.
- Astra recheck: no remaining code blocker; earlier doc correction now applied. Opus final: all six Should-fix,
  seven Nice-to-have, and later pinning-help finding closed; nothing open. Opus independently ran 67 targeted
  pure tests and the 22-case contract check. Neither edited files.
- Final `npm run typecheck`, `git diff --check`, upstream contract PASS.

### Live state / cleanup

Only `strata-monitor` reloaded; reload response and subsequent `paseo plugin ls --json` report **running** at
`/home/delirious6423/code/strata-paseo`. Paseo daemon not restarted. No real tune/benchmark/inference/update,
launch-config mutation, preset mutation or backup deletion on the host for these fixes.

All owned test runs stopped/discarded or reset/released to frozen harness warm pools. ARM cleanup independently
verified after each platform: only stopped bases remain; Windows run absent, owned QEMU gone, goldens intact.
This implementation was subsequently committed and pushed with user approval as
[commit 69043fa](https://github.com/delirious6423/paseo-strata-monitor/commit/69043fa1bf994fb7830b07f36d7ac588658cac0f);
the remote SHA matched local HEAD and the working tree was clean at publication. Newer docs/mobile-UI work is separate.
Native non-Linux GUI and real-engine/GPU acceptance remain untested, not implied by fixture or isolated function checks.

### Earlier work

Gyro-L installed/registered with dedicated engine fork and checksum verification. Expanded dashboard exposes
selectable tune/bench options, 30 guided config fields/full JSON, preset administration and collapsed logs/details.
See `docs/dashboard-coverage.md` for actual coverage and deliberate exclusions.
