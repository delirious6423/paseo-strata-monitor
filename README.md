# Strata for Paseo

A [Paseo](https://paseo.sh) plugin for a local [Strata](https://github.com/niko1221/strata) inference server: find
the Strata models on your machine, load or stop one with a click, and watch the server's live speed and load.

- **Model picker**: every Strata model found on the machine, grouped by quant provider (and by model family when
  there are several), smallest first. Load, Abort while loading, Stop; loading one model stops the other first. One load or stop runs at a time, even
  with several Paseo clients, and a Strata server the plugin did not start blocks Load until you stop it.
- **Tools** through Strata's own CLI: **Benchmark** with six suites and suite-specific controls;
  **Autotune** with Quick/Thorough depth, chat/coding workload, speed/room/reserve objectives, custom budget,
  RAM reserve, preset name and measurement-only mode. Answer-changing and nonrepeatable settings require
  explicit opt-in. Saved tuning of a running model gets before/after benchmarks; measurement-only tuning
  restores its previous settings without comparison benchmarks. **Check for updates / Install update /
  Undo update** use Strata's signed feed. Disruptive operations require confirmation; one tool runs at a time.
- **Saved tuning** for the selected model: which preset it starts with and whether it is still valid for this PC
  and engine; use another, switch off, undo, delete, or **Re-check** (Strata's 2-minute check that a preset is
  still as fast). Inspect evidence, rename, export JSON, import an inactive matching preset, and inspect effective
  tuning for the next start. A warning replaces it for a model whose server does not apply presets.
- **Model configuration**: 30 guided controls plus advanced JSON. Save only with all detected models stopped;
  stale revisions and unknown status probes are refused and the previous file is backed up. Saving never
  starts or restarts a model. Old plugin backups are archived by default; deleting older ones requires explicit
  consent for that save and keeps the newest 10 total.
- **Server log and job details**: collapsed by default, including failures. Expand only when needed.
- **Idle stop** (Settings, off by default): stop a model after 15, 30, 60 or 120 minutes without requests, to
  free the GPU.
- **Live status**: an always-visible sidebar row with prefill and decode tok/s, and a screen with a speed graph,
  queue, GPU/RAM use and recent requests.

## Install

```bash
paseo plugin add git:delirious6423/paseo-strata-monitor
```

Requires Paseo 0.12.0 or later (in use on 0.13.0) and a Strata install. Works on Linux, Windows and macOS.
What changed in each version: [CHANGELOG.md](CHANGELOG.md); latest release notes: [docs/releases/0.2.0.md](docs/releases/0.2.0.md).

## How it finds models

The same places Strata itself uses, read-only:

1. **Strata installs**: `STRATA_INSTALL_DIR` if set (then only that), else the installs remembered in Strata's
   settings file (`~/.config/strata/settings.json`, Windows `%APPDATA%\Strata\settings.json`) and the desktop
   app's install (`~/.local/share/strata/install`, Windows `%LOCALAPPDATA%\Strata\install`). Each holds
   setup-written `strata-<model>.json` run configs.
2. **Your own systemd user services** (Linux): a unit whose command, or the script it runs, passes
   `--config <run config>`, including template units such as `strata@.service` running `run-%i.sh`. Those models
   start and stop through their unit, so desktop shortcuts and Paseo agree. Turn off in the plugin settings.
3. **Extra folders** you add in Settings → Plugins → Strata → Model discovery: any Strata run config JSON in them.

Model facts come from the files: GGUF headers (`general.quantized_by`, `basename`, `name`), EXL3
`quantization_config.json` and model card front matter, Hugging Face cache folder names, then file names. Sizes
are the weight files on disk (split GGUFs summed, linked files counted once).

## How it starts and stops models

- A model run by a systemd user unit: `systemctl --user start|stop <unit>`.
- Any other model: Strata's own command-line tool from its install (`bin/strata`, or `strata` on PATH):
  `strata profile create paseo-<model> --from-config <run config>`, then `strata runtime start|status|stop`.
  These `paseo-<model>-<hash>` profiles (the hash is of the run config's path) live in Strata's profile folder;
  delete them there to undo. On Windows, paths containing `%`, `!` or `"` are refused rather than passed through
  `cmd.exe`, which would expand them.
- A model counts as ready when its server's `/health` reports a Strata server with the model loaded.

## How the tools run

Each uses Strata's command-line tool: the model's own install's when it has one, else the first Strata install
that has one, else `strata` on PATH (systemd-run models record no install, so they get the first one). One tool
runs at a time; Load, and Saved tuning changes, wait until it ends.

- Benchmark: `strata bench run --url <the model's server> --suite <selected suite> --out <new folder>`;
  serving-smoke is the default. Prompts/token lengths come from the suite, not custom inputs. Reports go to
  the plugin's folder (`~/.local/state/paseo-strata/bench`, macOS `~/Library/Application Support/paseo-strata`,
  Windows `%LOCALAPPDATA%\paseo-strata`).
- Autotune: `strata tune auto <run config> --mode quick|thorough --status-file …`. The screen shows skipped settings; no winner means no faster setting found in that search, not proof of optimality. Available controls and deliberate exclusions: [dashboard coverage](docs/dashboard-coverage.md). Undo a saved preset with
  `strata presets undo` or `strata presets off`. The result is remembered: Strata's server applies the saved preset
  at every start (its log says `saved tuning '…' applied`), so autotune once per model, and again after a new
  engine, driver or GPU. Only a server with Strata's preset support applies them (`apply_saved_tuning` in its `serve/server.py`); for a model whose server lacks it, the screen warns that a result would not be used.
- Before/after (autotune of a running model): one throwaway `bench run` (the first requests after a start are
  slow: 41.6 against 66-73 tok/s steady on Gyro-S), then `--repeat 3`, before the tune and after the restart. The
  plugin compares the mean tok/s per phase itself (`strata bench compare` refuses runs whose server settings
  differ, which a tune may cause) and calls a change under 10%, or under the repeats' own spread, "no clear
  change": separate runs of the same settings differed by up to 9% here.
- Saved tuning: `strata presets status <run config>`, `presets apply|delete <id>`, `presets off <run config>`,
  `presets undo <run config> --config <run config>`, `presets recheck <id> <run config> --status-file …`.
- Server log: `journalctl --user -u <unit>` for a systemd model, else the tail of Strata's
  `<state>/strata/runtime/paseo-<model>.server.log` (`STRATA_RUNTIME_DIR` if set).
- Idle stop: every 30 s the plugin reads the running server's `/metrics` (as the screen does); a model whose
  request total has not moved, with nothing queued and state `idle`, for the set minutes is stopped. A server it
  cannot read counts as busy. A running tool resets the count.
- Update: `strata update --check`, then `strata update --output jsonl --wait 0`. Strata switches to a new engine
  only after a test start and keeps the previous one (`strata components rollback`). An update installs into
  Strata's component folder; a run config that starts its own engine file is not changed, and the screen says so.
- Undo update: `strata components rollback --output json --wait 0`, offered when `update --check` names a
  previous engine.

Cancel sends Ctrl+C (Windows: ends the process tree, so Strata gets no chance to tidy up; it keeps the previous
engine until a new one passed its test start). Strata installs engine and control separately, so a cancelled update
can leave one updated: the result shows the versions installed afterwards. A cancelled autotune shows whether a
preset was saved (from `strata presets list` before and after). Stop on a model being benchmarked cancels the
benchmark first. The last 20 results are kept in the plugin's folder.

## How it finds a running server (live status)

Every 10 seconds it collects candidates and keeps those whose `/health` says they are Strata, then reads `/metrics`:
URLs you add in the plugin settings; local TCP listeners owned by a Strata server process (`serve/server.py`,
found via `/proc` on Linux, `lsof` on macOS, PowerShell `Get-NetTCPConnection` on Windows); the ports in the
found run configs; Strata's saved monitor connections (`strata_cli` connections folder); ports 8095 and 8080.
Between scans it polls one server: every second while it generates, every 3 seconds otherwise, while a Paseo window
shows the sidebar row or the Strata screen.

## Limits

- The before/after speed is a rough check (the same quick benchmark a few minutes apart, not a controlled test).
- Saving is enabled by default; measurement-only tuning saves/applies nothing. A saved objective must match
  the model's resource profile; switch profile in Model configuration or choose measurement only.
- Configuration editing refuses recognized credential-bearing files and nonloopback bindings. Backups preserve
  the previous document; advanced JSON can change engine behavior and must be reviewed before saving.
- Preset JSON import allows supported tuning settings only; unsupported flags/env are rejected rather than
  silently discarded. Export redacts recognized credentials; inspect it before sharing.
- Idle stop needs the model's own server to answer `/metrics`; a model it cannot read is never stopped.
- Saved tuning changes are serialized within the plugin, not against the Strata app changing presets at the
  same moment. Preset bookkeeping is allowed during benchmarks; a queued mutation can delay Stop by up to
  four 60-second CLI calls.
- Guided engine edits are deliberate overrides. Autotune and Re-check refuse pinned candidate settings;
  the effective-settings panel reports actual overrides after saved tuning. Reset the field to Default or
  review Advanced JSON to unpin it. A resource profile only selects a saved-tuning slot, not a memory budget.
- Unknown model status offers Stop/recover, not a successful no-op Load. Failed status collection is never
  evidence that configuration writing is safe.

- "A Strata server the plugin did not start" means a local listener owned by a Strata server process
  (`serve/server.py`) whose `/health` answers. One that is still loading, or listening only on a LAN address,
  is not seen, so Load is not blocked by it.
- `/health` saying `service: "strata"` identifies a Strata server; it does not authenticate one. Keys only go
  to this machine, URLs you added, and saved connections' own credentials, so set those deliberately.
- On a very slow Windows machine PowerShell's first start can exceed the 8 s listener scan; that scan then finds
  nothing, and the next one (10 s later) catches up.

## Privacy

The plugin reads local files listed above and talks only to Strata servers: loopback ports on this machine,
plus any URL you add or saved in a Strata connection. It has no telemetry. Check for updates and Install update
run Strata's own CLI, which contacts Strata's signed update feed (and downloads from it on Install); Benchmark
and Autotune run only against this machine's server and GPU.
A bearer token is sent only to a server whose unauthenticated `/health` already identified it as Strata: a saved
connection's own `credential_env` to that connection, and `STRATA_API_KEY` from the daemon's environment to
servers on this machine or URLs you added. A saved connection never falls back to `STRATA_API_KEY`.

## Develop

```bash
npm install
npm run typecheck
bash tests/vm/run.sh
```

Unit, integration and browser checks in throwaway VMs: [TESTING.md](TESTING.md).

![The Strata screen in Paseo: model picker grouped by provider, a loaded model and its live speed](assets/screenshot.png)

| Phone | Phone, dark | Tools | Model discovery settings |
|---|---|---|---|
| ![Strata screen on a phone](assets/phone.png) | ![Strata screen on a phone, dark theme](assets/phone-dark.png) | ![Benchmark result and update check](assets/phone-tools.png) | ![Model discovery settings](assets/settings.png) |

Screenshots (2026-10-25): the Paseo AppImage installed here, in a throwaway VM with demo models (real names and sizes, empty weights) and a stand-in
Strata server and CLI, so the speeds, benchmark and versions are made up; `tests/vm/screenshot.sh` recreates them.

MIT licensed.
