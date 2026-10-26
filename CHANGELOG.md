# Changelog

All notable changes to this plugin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/) (0.x: settings and RPCs may still change).

## [Unreleased]

Expanded dashboard on `main`, after the 0.2.0 tag. Package version remains 0.2.0; no new release tag is
implied. Details and migration guidance: [current change notes](docs/releases/unreleased.md).

### Added

- Selectable Quick/Thorough tuning depth, chat/coding workload, speed/room/reserve goals, RAM/time budgets,
  answer-change permissions, custom names, quiet check, boot timeout and measurement-only mode.
- All six audited benchmark suites with supported serving controls or standard protocol metadata.
- Model configuration: 30 guided fields and full JSON, stopped-only atomic saves, SHA-256 conflict checks,
  private backups, non-destructive archiving and explicit per-save consent for pruning to 10 total backups.
- Preset evidence/details, rename, redacted export, validated matching-slot inactive JSON import and effective
  settings with raw user overrides.
- Selected-model default screen, collapsed grouped picker/task cards, mobile-friendly controls and form drafts
  preserved across section hiding and Load/Stop transitions. Separate UI pass: 17/17 VM browser checks,
  zero page errors; phone viewports do not establish native mobile acceptance.
- Compact mobile-only follow-up after iPhone Air feedback: tighter cards, gaps and headings; controls remain
  at least 44px and inputs 16px, with system text scaling intact. Latest VM run: 18/18 checks, zero page errors,
  including a 420×912 viewport. Desktop unchanged; current phone screenshots refreshed.
- Unknown-status recovery, pinned-setting explanations, 22 isolated actual-upstream contract cases and VM
  browser coverage. Latest accepted matrix: 554 unit passes, 11 platform skips, 235 integration passes and
  13 browser checks; see [Testing](TESTING.md) for scope and evidence.

### Changed

- Logs and job details stay collapsed, including failures. Answer-changing permissions remain off by default.
- Saved goals must match the resource-profile slot; resource profile is not itself a memory reservation.
- Measurement-only tuning restores previous state without unnecessary comparison benchmarks or speed deltas.
- Preset bookkeeping remains available during benchmarks without releasing the Load guard; queued Stop delay
  is documented. Numeric drafts preserve decimal entry and invalid text without displaying NaN.

### Fixed

- Invalid imported timestamps/nested metadata could poison persistent preset listing; foreign recheck claims
  are now cleared and unsupported settings rejected before writes.
- Failed runtime/systemd probes could be mistaken for stopped; unknown now blocks saves/Load and offers recovery.
- Raw/captured user overrides could defeat autotune or Re-check; guards reject shadowed candidates before
  workload disruption, and effective settings reflect overrides after preset application.
- Guided segment/layer/split/vision edits could leave conflicting arguments in place.
- URL-only managed-match option always failed and was removed. Condition labels, 80-character names and
  STRATA_ credential-variable names are validated; empty background lines are omitted.
- Nonconforming/partial standard protocol results were mislabeled as failed requests; busy-message wording
  and coverage documentation are corrected.

## [0.2.0] - 2026-10-25

Historical release snapshot. Defaults, test counts and automatic log expansion below describe that tag,
not current `main`; use the Unreleased section and current guides for today’s behavior.

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
  - **Autotune** (quick, about 20 minutes): searches for faster settings and saves them as a preset the server
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
- On the Windows ARM64 VM, PowerShell's first start can exceed the 8 s listener scan once.

## [0.1.0] - 2026-10-20

### Added

- Live Strata status in Paseo: a sidebar row with prefill and decode tok/s, and a screen with a speed graph,
  queue, GPU and RAM use, and recent requests, read from a local Strata server's `/metrics`.

[Unreleased]: https://github.com/delirious6423/paseo-strata-monitor/compare/v0.2.0...main
[0.2.0]: https://github.com/delirious6423/paseo-strata-monitor/tree/v0.2.0
[0.1.0]: https://github.com/delirious6423/paseo-strata-monitor/commit/a9b19d3
