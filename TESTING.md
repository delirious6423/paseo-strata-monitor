# Testing

## Unit tests (host)

`npm test`: parsers (GGUF header, systemd `ExecStart`, launch scripts, `/proc/net/tcp`, `lsof`), discovery on
fixture machines (Linux settings file, Windows `%APPDATA%`/`%LOCALAPPDATA%`, `STRATA_INSTALL_DIR`, systemd
template and plain units, extra folders, split GGUFs, HF cache), picker order, saved connections. Regression tests
from the 2026-10-24 review: ids stay with their config across rescans; malformed settings/metadata skip only that
part; split GGUFs past 64 parts report an unknown size; commented-out `--config` lines and escaped quotes; a saved
connection's prefix cannot change the host; credentials go only to servers whose `/health` says Strata (real HTTP
servers, checked headers, also on steady-state polls and when a saved connection shares a URL); `/health` counts as
ready only with `loaded: true`; Windows `.cmd` lines refuse `%`/`!`/quotes; EXL3 bits read from the head of a
`quantization_config.json` larger than the read limit. `server/control.test.ts` (Linux) drives load/stop against a
fake `systemctl` that is slow on `reset-failed`: an Abort in that window, or one Stop after several Loads, never
lets the model start. A polling test counts full scans with a decoy: a stop or failed load rescans once (not
for minutes); a started model is scanned for on every poll, even while another server answers, until its port does.

## End-to-end in throwaway VMs

`tests/vm/e2e.ts` runs the plugin's daemon-side code (discovery, start/stop, analytics) on a machine that has
never seen the author's setup. It builds a Strata-like layout in the OS's own places: Strata's settings file
naming an install in a folder with a space in its name, GGUF files with real headers, a template systemd user
unit whose script uses `$HOME` (Linux), and an unrelated HTTP server on a probed port that must be ignored and never receive the `STRATA_API_KEY` set for the run. The fake Strata CLI
and server (`tests/vm/fake-strata`, Node only) speak the same `profile`/`runtime` JSON and `/metrics` shape as
Strata. Analytics get no configured ports, so they must find servers by scanning listeners. Control checks include two
loads at once (exactly one model runs), Abort while the Load is still stopping the previous model (nothing
starts), and Load refusing while a Strata server the plugin did not start is running. Tools: update check, a
benchmark of the running model, autotune (measures before, stops the model, blocks Load, result, starts it again
and measures after), autotune Cancel, an update with progress and its Cancel, Undo update, saved tuning (listed,
switch off, undo, re-check), Cancel while autotune starts the model again, a failed autotune of a running model, the server log, idle stop, and Stop during a benchmark, against the fake CLI's
`bench`/`tune`/`update`/`presets`/`components`. 38 checks.

Real Strata (this machine, Gyro-S, 2026-10-25): autotune with before/after, 224 s, "already the fastest", speed
"no clear change" (81.1 → 74.7 and 87.3 → 80.8 tok/s); the first try without warm-up showed −31% for the same
settings, which led to the warm-up run and the 10% band. Saved tuning read, delete and apply restored the original
preset; the 4 EXL3 models are flagged as not applying presets.

The VM runners come from the dotfiles repo (`DOTFILES_ROOT`, default `~/code/dotfiles`); each refuses to touch an
existing run and discards its own VM afterwards.

| Target | Command | Last result (2026-10-24) |
|---|---|---|
| Linux x64 | `tests/vm/run.sh` (Incus, Ubuntu 26.04, Node 22 from apt) | PASS 38/38 |
| Linux ARM64 | `tests/vm/macos.sh linux-arm` (Tart on Apple Silicon, Ubuntu) | PASS 38/38 |
| Windows x64 | `tests/vm/windows.sh` (Incus, Windows 11 26300) | PASS 38/38 |
| Windows ARM64 | `tests/vm/windows.sh --arm64` (QEMU/hvf on Apple Silicon) | PASS 38/38 (earlier 20-check runs: 3 of 4; one first listener scan empty, see below) |
| macOS ARM64 | `tests/vm/macos.sh` (Tart, macOS 26.6) | PASS 38/38 |

Known flake: on the emulated Windows ARM64 VM, PowerShell's first start can exceed the listener scan's 8 s
timeout, so that one scan comes back empty; the next scan (10 s later) finds the server. On such a slow machine
the Load guard against a foreign Strata server is skipped for that scan (it fails open, not closed).

## Screenshots

`tests/vm/screenshot.sh` runs the real Paseo daemon from the Paseo AppImage (as Node) in a throwaway Incus VM,
installs the plugin from a `git archive` of HEAD (what a public install gets, no `node_modules`), builds a demo
Strata machine (`tests/vm/demo.mjs`: the author's model line-up as sparse files with real-shaped metadata) and
lets the host's Brave (headless, `puppeteer-core`) press Load in Paseo's web client and capture desktop and phone,
light and dark, plus the settings screen into `assets/`. Last run 2026-10-24: plugin `running`, Load reached Ready.

Not covered by the VMs: the real Strata CLI and engine (no GPU or models in a VM; the real `profile`/`runtime`
path was run on the author's Linux machine with a real model, as were the systemd path and analytics), and the
Paseo app UI itself (no automated UI test; check the Strata screen and settings by hand after UI changes).
