# Changelog

All notable changes to this plugin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/) (0.x: settings and RPCs may still change).

## [0.2.0] - 2026-10-25

From a speed monitor to a control panel for a local Strata: find models, load and stop them, and run Strata's own
benchmark, autotune and update tools from Paseo, on a phone too. Release notes: [docs/releases/0.2.0.md](docs/releases/0.2.0.md).

### Added

- **Model picker with Load, Abort and Stop.** Every Strata model on the machine, grouped by quant provider (and
  model family), smallest first. Loading one model stops the other first; one load or stop runs at a time, even
  with several Paseo clients; an Abort always wins over a Load still preparing.
- **Model discovery that works on any machine**, read-only, in the places Strata uses: `STRATA_INSTALL_DIR`,
  installs in Strata's settings file, the desktop app's install; Linux systemd user services (plain and template
  units, and the scripts they run), started and stopped through their unit; extra folders from the settings.
  Facts come from GGUF headers, EXL3 `quantization_config.json`, model cards and Hugging Face cache names.
- **Strata CLI control** for models outside systemd: plugin-owned `paseo-<model>-<hash>` profiles with
  `strata runtime start|status|stop`.
- **Tools**, through Strata's own command-line tool, one at a time (Load waits):
  - **Benchmark**: Strata's serving-smoke suite against the running model (tok/s, time to first token, alone
    and 4 at once).
  - **Autotune** (quick, about 20 minutes): finds the fastest settings and saves them as a preset the server
    applies at every start. A running model is measured before (one warm-up run, then 3 repeats), started again
    and measured after; changes under 10%, or under the runs' own spread, are called "no clear change".
  - **Check for updates / Install update / Undo update**: engine and control from Strata's signed feed, with
    download progress, and `components rollback` to the engine version the last update kept.
- **Saved tuning** per model: which preset it starts with and whether it still fits this PC and engine; use
  another, switch off, undo, delete, and Strata's 2-minute **Re-check**.
- **"Result not kept" warning** for a model whose server lacks Strata's preset support (read from the
  `serve/server.py` it runs), e.g. a custom Strata copy.
- **Server log**: the last lines of the model's journal or Strata runtime log; opens by itself when a load fails.
- **Idle stop** (Settings → Free the GPU, off by default): stop a model after 15, 30, 60 or 120 minutes without
  requests. Only the model's own server's counters count; anything unreadable counts as busy.
- **Warning for a Strata server the plugin did not start**; Load is refused while one runs.
- **Settings → Model discovery**: extra folders, extra servers (other machines), systemd on/off, and every place
  searched with its model count.
- Live status finds servers by local listeners owned by a Strata server process (Linux `/proc`, macOS `lsof`,
  Windows PowerShell), run config ports, Strata's saved connections, ports 8095 and 8080.
- Screenshots (desktop, phone, dark, tools, settings) from a real Paseo in a throwaway VM.
- Tests: 43 unit tests; 38 end-to-end checks in throwaway VMs on Linux x64/ARM64, Windows x64/ARM64 and macOS
  ARM64 against a stand-in Strata CLI and server.

### Changed

- Credentials (`STRATA_API_KEY`, a saved connection's own key) are sent only to a server whose unauthenticated
  `/health` identified it as Strata, and only to this machine, URLs you added or that connection.
- A model counts as ready only when `/health` reports it loaded.
- Model ids are stable across rescans (a hash of the run config's real path).
- The sidebar polls every 15 s when idle; analytics rescan once after a stop instead of for minutes.

### Fixed (found in outside review rounds, each with a regression test)

- Cancel could stop an update check instead of the running Autotune; a cancel could outlive its job.
- Two near-simultaneous tool presses could both run on the GPU; the tool slot is now claimed at the press.
- Cancel reported "nothing changed" when Strata had already installed part of an update or saved a preset; it
  now reports what is installed or saved afterwards.
- A failed autotune showed as done; "faster settings saved" was shown when saving failed.
- The first before/after measurement showed −31% for unchanged settings (cold start); now warm-up and repeats.
- Idle stop could have matched another machine's server on the same port, or acted while a tool started.
- macOS listener scan timed out on a busy machine (lsof given 8 s); EXL3 bits read from huge
  `quantization_config.json` files; Windows `cmd.exe` arguments with `%`, `!` or quotes are refused.

### Known limits

- systemd-run models use the first Strata install's command-line tool for the tools.
- Install update does not change models whose run configs start their own engine files; the screen says so.
- Windows Cancel ends the process tree outright (no Ctrl+C for another process tree there).
- On the emulated Windows ARM64 VM, PowerShell's first start can exceed the 8 s listener scan once.

## [0.1.0] - 2026-10-20

### Added

- Live Strata status in Paseo: a sidebar row with prefill and decode tok/s, and a screen with a speed graph,
  queue, GPU and RAM use, and recent requests, read from a local Strata server's `/metrics`.

[0.2.0]: https://github.com/delirious6423/paseo-strata-monitor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/delirious6423/paseo-strata-monitor/releases/tag/v0.1.0
