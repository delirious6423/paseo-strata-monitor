# Progress

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
Local edits only; no commit/push requested or performed. Native non-Linux GUI and real-engine/GPU acceptance
remain untested, not implied by fixture or isolated function checks.

### Earlier work

Gyro-L installed/registered with dedicated engine fork and checksum verification. Expanded dashboard exposes
selectable tune/bench options, 30 guided config fields/full JSON, preset administration and collapsed logs/details.
See `docs/dashboard-coverage.md` for actual coverage and deliberate exclusions.
