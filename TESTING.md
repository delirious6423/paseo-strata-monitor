# Testing

App, integration and browser checks run in disposable VMs, never against live host models by default.
`npm run typecheck` is safe on the host. The full `npm test` suite includes local HTTP/process fixtures;
use the VM runners for it. All runners bundle `server/*.test.ts` and run unit tests before integration.

## Latest acceptance: 2026-10-26

| Native target | Command | Unit tests | Integration |
|---|---|---|---|
| Linux x64 | `bash tests/vm/run.sh` | PASS 113, no skips | PASS 47/47 |
| Linux ARM64 | `bash tests/vm/macos.sh linux-arm` | PASS 113, no skips | PASS 47/47 |
| Windows x64 | `bash tests/vm/windows.sh` | PASS 110, 3 Linux-only skips | PASS 47/47 |
| Windows ARM64 | `bash tests/vm/windows.sh --arm64` | PASS 110, 3 Linux-only skips | PASS 47/47 |
| macOS ARM64 | `bash tests/vm/macos.sh` | PASS 108, 5 systemd skips | PASS 47/47 |

Linux/Windows use native VM runners from `~/code/dotfiles` (`DOTFILES_ROOT` override). ARM64 targets run on
Apple Silicon; the runner verifies the ARM64 Node binary. Node v22.22.1. macOS Darwin 25.6.0; Windows 11
build 26300. All owned runs were stopped/discarded; golden images and unrelated/frozen warm pools preserved. The native suites used a frozen source manifest;
only two field-help strings changed afterwards, warning that pinning Speculative window/CPU workers blocks
tuning until Default is restored. The final browser and upstream-contract reruns include those copy changes.

Evidence outside the repository:
- Windows x64: `/tmp/strata-review-fixes-windows-x64-final.log`
- Linux x64: `/tmp/strata-review-fixes-linux-x64-final.log`
- ARM native targets: `/mnt/data4tb/strata-paseo-arm-acceptance-20261026/final/`, including source SHA-256
  manifest, architecture evidence and independent post-run inventories.

Early failures were fixture/harness issues: platform-dependent path assertions, POSIX mode assertion on Windows,
Darwin systemd expectations, and insufficient guest `/tmp` space for the browser/AppImage. Fixed with native
paths, platform-specific assertions/skips and browser assets on the guest filesystem. The table records reruns,
not those failed attempts.

## Regression scope

Unit coverage includes discovery/parsers, readiness and credential routing, idle-stop rules, cancellation,
queue/busy coordination, option-to-argv contracts, saved-goal/load-slot compatibility, model-config validation
and atomic saves, stale digests, credential refusal, unknown argument preservation, safe preset imports,
redaction and temporary-file cleanup. The actual `exclusive`/`withPresetMutation` test uses a deferred admitted
operation, immediate busy reservation and error release; it does not substitute a fake lock.

`tests/vm/e2e.ts` creates a stand-in Strata install in OS-native locations. It checks model switching, concurrent
Load/Abort/Stop, listener discovery, analytics, foreign-server refusal, fresh scan after a cached-empty scan,
CLI option forwarding, tune/cancel/restart/before-after flow, saved tuning, updates/undo, idle stop and benchmark
cancellation. An unrelated HTTP listener must never receive credentials. There is no GPU inference in these tests.

## Actual upstream contract checks

```bash
python3 -I tests/upstream-contract.py /path/to/Strata/runtime
```

**22/22 PASS** against `/mnt/data4tb/Strata-data/gyro-l-runtime`. This pure check extracts the actual Python AST
for upstream benchmark validators, rename bounds, user-argument merge and engine argument shaping. It compares
them with outputs from this plugin's real TypeScript helpers. No upstream module/app is imported or launched;
hardware/drafting/I/O dependencies are stubbed for the three engine-argument precedence cases.

The fake CLI also enforces the condition-name regex, managed-profile requirement and 80-character name limit.
These supplement, not replace, real-engine acceptance. New VM regressions exercise failed status -> unknown ->
Save/Load refusal, bookkeeping during benchmarks without releasing Load, raw override rejection, Re-check
refusal before stopping the model, and measurement-only tuning without comparison benchmarks.

## Real Paseo browser acceptance

```bash
bash tests/vm/dashboard-ui.sh
```

Both the real Paseo daemon and headless Brave run in the disposable Linux VM. The host only drives DevTools;
no host browser or real inference is launched. Browser assets live on the guest disk, not its small `/tmp` tmpfs.
The script installs the working-tree plugin (including untracked new modules, excluding `node_modules`) and
uses sparse demo model files plus a fake Strata CLI/server.

Latest: **13/13 PASS**, no browser page errors. Checks cover collapsed defaults, tuning controls and answer-change
warnings, suite-specific benchmark controls, confirmed benchmark with collapsed results, model-config/advanced
JSON panels, stopped-only config save with backup and no launch, explicit backup-deletion consent/reset,
preset inspect/rename/export/import round trip, decimal/invalid numeric drafts, condition/env validation,
and desktop/phone light/dark captures. Evidence:
`/mnt/data4tb/strata-dashboard-tests/20261026-113500/`.

`tests/vm/screenshot.sh` is the older screenshot generator; it uses a host browser and is not the acceptance
runner for this change. Existing `assets/` screenshots are historical.

## Limits and historical evidence

- These fixtures verify plugin/CLI contracts, not every real engine option, update payload or hardware behavior.
  Real-engine acceptance for this expansion is NOT APPLICABLE: no real benchmark/tune/update/re-check was
  authorized or started. UI acceptance is Linux/browser only; native desktop GUI testing on other OSs is not covered.
- Native Windows skips three Linux systemd process tests; macOS additionally skips two systemd discovery fixtures.
  The same tests pass natively on both Linux architectures.
- On a slow Windows VM, PowerShell startup can exceed the 8-second listener scan timeout. That scan can miss a
  foreign server until the next scan; freshness bypasses caching but cannot eliminate OS probe timeouts.
- Historical real Gyro-S testing (2026-10-25) led to warmup and a 10%/repeat-spread comparison band. Before/after
  measurements remain uncontrolled sanity checks, not performance proofs. No historical result substitutes for
  current real-engine acceptance.
