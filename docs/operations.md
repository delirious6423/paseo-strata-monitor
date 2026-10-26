# Operations and limitations

[README](../README.md) · [Dashboard coverage](dashboard-coverage.md) · [Testing](../TESTING.md)

This guide describes the expanded dashboard on `main`. The package remains version 0.2.0; see
[current change notes](releases/unreleased.md) for additions since the tagged release.

## Finding controls

The default screen shows the selected model and Load/Stop. **Change model** opens the grouped picker and
closes on selection. Task cards start collapsed:

- **Model details and discovery:** launcher details, server log and search locations.
- **Tuning and benchmarks:** workload controls, autotune and benchmark runs.
- **Configuration and presets:** guided/JSON model editing and preset administration.
- **Activity and updates:** recent results and component maintenance.

When online, live metrics lead; hardware/history is optional. Active jobs, Cancel and action errors stay
visible outside collapsed cards. Closing a card or loading/stopping a model preserves form drafts.

## Discovery and model facts

Discovery reads the same install locations Strata uses:

1. `STRATA_INSTALL_DIR`, when set, restricts install discovery to that directory.
2. Otherwise, installs remembered in Strata’s settings file and the desktop app’s install are searched.
   Common paths are `~/.config/strata/settings.json` and `~/.local/share/strata/install`; Windows uses
   `%APPDATA%\Strata\settings.json` and `%LOCALAPPDATA%\Strata\install`.
3. Linux systemd user services are also inspected when enabled, including template units and scripts passing
   `--config <run config>`.
4. Extra folders added in plugin settings are searched for existing Strata run configs.

Run configs name the executable, model arguments and port. A GGUF download alone does not create a runnable
entry. Downloading, packing and installing models remain outside the plugin.

Facts come from GGUF headers, EXL3 `quantization_config.json`, model cards, Hugging Face cache names, then
filenames. Split GGUF sizes are summed; linked files are counted once. Incomplete metadata can produce unknown
sizes rather than an understated total. Discovery does not copy model weights.

## Load, Stop and recovery

| Launcher | What the plugin uses |
|---|---|
| Linux systemd user service | The existing unit through `systemctl --user` |
| Other prepared model | The install’s Strata CLI, using a plugin profile and `runtime start/status/stop` |

Profiles are named `paseo-<model>-<hash>`; the hash comes from the config path. `STRATA_PROFILE_DIR` overrides
the profile directory; otherwise it is under Strata’s config directory. Profiles are persistent, not temporary
model copies.

Load/Stop requests share a queue across Paseo clients. Loading another model stops the previous one first.
Abort/Stop invalidates earlier pending Loads. Ready means `/health` identifies Strata and says the model is loaded.

A failed runtime/systemd status probe produces **unknown**, not stopped. Unknown state blocks configuration
writes and Load; use **Stop / recover unknown model**, resolve any reported error, then search again.

A foreign local Strata server also blocks Load when the listener scan finds its process and `/health` answers.
Stop that server where it was started. This is not complete GPU ownership detection: servers still loading,
listeners bound only to a LAN address, and timed-out OS probes can be missed. Fresh mutation checks bypass
cached results but do not eliminate probe timeouts.

Windows `.cmd` launchers refuse paths/arguments containing `%`, `!`, quotes or line breaks rather than letting
`cmd.exe` expand or reinterpret them.

## Tools and saved tuning

The selected model’s install supplies the CLI. For a systemd model without a recorded install, the first
available Strata install is used; `strata` on PATH is the fallback. This matters when several installs have
different CLI versions. The UI reflects the audited upstream contracts, not every historical Strata version.

| Action | CLI family |
|---|---|
| Benchmark | `strata bench run --url … --suite … --out …` |
| Autotune | `strata tune auto <config> --mode quick\|thorough …` |
| Preset administration | `strata presets status/show/apply/off/undo/delete/recheck/rename/import/effective …` |
| Update check/install | `strata update --check`, then `strata update --output jsonl --wait 0` |
| Undo engine update | `strata components rollback --output json --wait 0` |

These are command shapes, not commands to paste with literal ellipses. The dashboard supplies validated IDs,
config paths, output directories and status files. It does not accept arbitrary caller-supplied CLI arguments.

### Tuning and overrides

Quick/Thorough control search depth and default budgets, not permission to change answers. The two
answer-change permissions are separate and initially off. A no-winner result means no faster setting was
found in that search, not proof of optimality.

Saved goals must match the load-time slot: `ui_resource_profile: "full"` selects speed, `"work"` selects room.
A positive RAM reserve also selects room. The profile itself changes no memory allocation. Measurement-only
runs can explore another goal without changing the saved profile or preset.

Guided engine settings create deliberate `user_args` overrides. Autotune and Re-check reject pins that would
shadow candidate settings. Restore Default for fields such as Speculative window/CPU pool workers, or review
advanced JSON. Effective tuning displays the actual raw overrides applied after preset arguments; engine-side
features such as drafting can still shape the final launch.

Saved tuning is only used by a server with Strata’s preset support. Custom server copies lacking that support
get a warning. Presets can become stale after engine, driver or hardware changes.

### Measurements, cancellation and concurrency

Saved tuning of a previously ready model uses a throwaway warmup benchmark and three measured repeats before
and after the tune. The plugin compares per-phase mean throughput. Differences below 10% or the repeats’ own
spread are described as no clear change. Separate runs are uncontrolled; this is not a performance proof.

Measurement-only tuning skips those comparison benchmarks. It restores a previously ready model with its
previous settings and leaves a previously stopped model stopped. A cancellation can leave the model stopped;
read the result before pressing Load.

One workload owns the tool slot. New Loads are refused while it runs. Preset bookkeeping can run during a
benchmark, but tune/re-check and other exclusive work still block mutations. Preset mutations share the
Load/Stop queue: Stop can wait behind up to four CLI calls, each bounded at 60 seconds.

Cancel interrupts the owned process. Windows ends its process tree without Strata’s normal Ctrl+C cleanup.
Cancellation can occur after part of an update or a preset save: the result reports what was actually installed
or saved. Stop during a benchmark cancels that benchmark before stopping the model.

## Configuration, backups and storage

Config editing is limited to known discovered models, at most 256 KiB and 40 nesting levels. Unknown keys and
unrelated argument groups are preserved by guided edits. Advanced JSON deliberately edits the whole document;
unknown fields are not exhaustively validated against every engine version.

Saving requires a fresh known stopped/failed state for all detected models, no detected foreign server, no
busy tool and a matching original SHA-256. A private backup is written before synced temporary output replaces
the file atomically. A conflicting external edit is refused. Saving never loads or restarts the model.

| Artifact | Location / policy |
|---|---|
| Linux plugin state | `${XDG_STATE_HOME:-~/.local/state}/paseo-strata` |
| Windows plugin state | `%LOCALAPPDATA%\paseo-strata` |
| macOS plugin state | `~/Library/Application Support/paseo-strata` |
| Benchmarks | `bench/` beneath plugin state; result paths shown in job details |
| Recent jobs | Last 20 retained in plugin state; screen shows the latest three |
| Config backups | Beside the config as `<config>.bak-paseo-<uuid>` |
| Backup archive | `<config>.paseo-backup-archive` |
| Server log | systemd journal or Strata runtime’s profile server log; `STRATA_RUNTIME_DIR` can override runtime storage |

Default retention keeps the newest 10 adjacent plugin backups and archives older ones without deleting data.
The archive can grow. A default-off checkbox on each save explicitly permits permanent pruning to the newest
10 total across adjacent/archive locations. Consent resets after save/reload. Only exact plugin-namespaced
regular files qualify; legacy backups, other configs, symlinks and lookalikes stay untouched. Retention errors
produce a warning without disguising a successful config save as a failed save.

Preset imports are limited to 512 KiB and 24 nesting levels. The slot must match; metadata and supported tuning
args/env/request settings are validated before the CLI writes anything. Foreign recheck claims are cleared.
Temporary import files are private and cleaned up; imported presets get a new identity and remain inactive.

## Monitoring, credentials and privacy

Monitoring finds candidates from added URLs, saved Strata connections, configured model ports, ports 8095/8080,
and local listeners owned by a Strata process. Listener discovery uses `/proc` on Linux, `lsof` on macOS and
PowerShell on Windows. Candidates must answer a Strata-shaped unauthenticated `/health` before monitoring
credentials are attached. The active server is polled while a visible Paseo client needs it; candidate scans
are cached for up to 10 seconds.

- A saved connection uses its own `credential_env`; it never falls back to `STRATA_API_KEY`.
- `STRATA_API_KEY` is available to monitoring of this machine or URLs explicitly added in plugin settings.
- Benchmark credential fields accept `STRATA_` environment-variable names, not pasted secret values.
- A Strata-shaped health response is identification, not authentication. Add URLs and credentials deliberately.
- The plugin has no telemetry. Strata’s update CLI contacts its signed feed and downloads on installation.
- Local files, logs, report folders, backups and exports can contain model metadata or user content. Recognized
  credential-bearing configs are refused and recognized export secrets are redacted, but arbitrary disguised
  secrets cannot be detected reliably. Review exports before sharing.

Idle stop is off initially. Every 30 seconds it checks the model’s own metrics; requests, a queue, generating,
unreadable counters or a running tool reset/prevent the idle decision. The settings UI offers 15/30/60/120 minutes.

## Updates and removal

Component updates do not replace a custom executable named by a run config. Dedicated forks, such as a prepared
Gyro-L runtime, need their own engine maintenance. Undo update is offered when Strata reports a retained engine.

Removing the Paseo plugin does not uninstall Strata, delete weights or remove persistent profiles, reports and
backups. Stop models deliberately before removing control access; keep or clean those artifacts through your
normal Strata/file-management workflow. No bulk data deletion is performed by this guide.
