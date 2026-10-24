# Strata for Paseo

A [Paseo](https://paseo.sh) plugin for a local [Strata](https://github.com/niko1221/strata) inference server: find
the Strata models on your machine, load or stop one with a click, and watch the server's live speed and load.

- **Model picker**: every Strata model found on the machine, grouped by quant provider (and by model family when
  there are several), smallest first. Load, Abort while loading, Stop; loading one model stops the other first. One load or stop runs at a time, even
  with several Paseo clients, and a Strata server the plugin did not start blocks Load until you stop it.
- **Live status**: an always-visible sidebar row with prefill and decode tok/s, and a screen with a speed graph,
  queue, GPU/RAM use and recent requests.

## Install

```bash
paseo plugin add git:delirious6423/paseo-strata-monitor
```

Requires Paseo 0.12.0 or later. Works on Linux, Windows and macOS.

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

## How it finds a running server (live status)

Every 10 seconds it collects candidates and keeps those whose `/health` says they are Strata, then reads `/metrics`:
URLs you add in the plugin settings; local TCP listeners owned by a Strata server process (`serve/server.py`,
found via `/proc` on Linux, `lsof` on macOS, PowerShell `Get-NetTCPConnection` on Windows); the ports in the
found run configs; Strata's saved monitor connections (`strata_cli` connections folder); ports 8095 and 8080.
Between scans it polls one server: every second while it generates, every 3 seconds otherwise, while a Paseo window
shows the sidebar row or the Strata screen.

## Privacy

The plugin reads local files listed above and talks only to Strata servers: loopback ports on this machine,
plus any URL you add or saved in a Strata connection. It sends nothing anywhere else and has no telemetry.
A bearer token is sent only to a server whose unauthenticated `/health` already identified it as Strata: a saved
connection's own `credential_env` to that connection, and `STRATA_API_KEY` from the daemon's environment to
servers on this machine or URLs you added. A saved connection never falls back to `STRATA_API_KEY`.

## Develop

```bash
npm install
npm run typecheck
npm test
```

Cross-platform end-to-end checks in throwaway VMs: [TESTING.md](TESTING.md).

![The Strata screen in Paseo: model picker grouped by provider, a loaded model and its live speed](assets/screenshot.png)

| Phone | Phone, dark | Model discovery settings |
|---|---|---|
| ![Strata screen on a phone](assets/phone.png) | ![Strata screen on a phone, dark theme](assets/phone-dark.png) | ![Model discovery settings](assets/settings.png) |

Screenshots: Paseo 0.12.0 in a throwaway VM with demo models (real names and sizes, empty weights) and a stand-in
Strata server, so the speeds are made up; `tests/vm/screenshot.sh` recreates them.

MIT licensed.
