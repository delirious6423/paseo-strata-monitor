# Strata for Paseo

Find and control local Strata models from Paseo, on desktop or phone. Watch live prefill/decode speed, queue,
GPU/RAM use and recent requests without leaving your workspace.

The default screen shows a selected model and Load/Stop. Change model opens the grouped picker; expandable
task cards hold tuning/benchmarks, configuration/presets, activity/updates and model details/discovery.
Live metrics appear first when online. Mobile controls use larger touch targets and readable form inputs;
drafts survive closing cards and loading/stopping models.

## What it does

- **Discover and load:** prepared Strata run configs, remembered installs, extra folders, and Linux systemd
  user services. Choose a model, Load, Abort, Stop, or recover unknown status. Switching models stops the
  previous one first.
- **Tune:** Quick/Thorough, chat/coding, speed/room/reserve goals, time/RAM budgets, explicit answer-change
  permissions, custom preset names, and save or measurement-only runs. Saved tuning of a ready model gets
  warmup/repeated before/after benchmarks; measurement-only runs restore previous settings without comparing
  an unapplied change.
- **Benchmark:** six upstream suites, with supported concurrency/repeat/timeout controls for serving suites
  and protocol metadata for standard-v1. Suite prompts and token counts remain fixed by Strata.
- **Configure:** 30 guided settings plus advanced JSON. Fresh stopped-state checks, revision checks, private
  backups and atomic replacement protect saves. Saving never starts or restarts a model.
- **Manage presets:** inspect evidence, apply/off/undo/delete/re-check, rename, export/import matching JSON,
  and view effective tuning. Imports stay inactive; unsupported settings and malformed metadata are rejected.
- **Maintain:** signed-feed component updates and engine rollback, collapsed server logs/job details, and
  optional idle stop after 15, 30, 60 or 120 minutes.

## Defaults and safeguards

Answer-changing permissions and idle stop start off. Logs, job details and option panels start collapsed.
Unknown model status blocks Load/config saves and offers Stop/recover. Tuning refuses overrides that would
shadow candidates. Resource profiles select saved-tuning slots; they do not reserve memory by themselves.

Old plugin backups are archived without deletion by default. Permanently pruning them requires explicit
consent on each save and preserves the newest 10 total; legacy and unrelated files are excluded.

The plugin has no telemetry. Monitoring talks to Strata servers on the daemon host, configured URLs and saved
connections. Strata’s update CLI contacts its signed feed. Config/export credential screening recognizes common
patterns, not arbitrary hidden secrets; review advanced JSON and exports before sharing.

## Requirements and scope

Paseo 0.12.0 or later and an existing Strata install with prepared run configs. Native fixture acceptance covers
Linux x64/ARM64, Windows x64/ARM64 and macOS ARM64. systemd control is Linux only. Remote servers can be
monitored, but model management is local to the daemon host. Model downloads, packing and custom engine builds
remain external.

Package version 0.2.0; the expanded dashboard is on `main` under
[current change notes](docs/releases/unreleased.md), not a newly tagged release.

[Install and use](README.md) · [Exact coverage](docs/dashboard-coverage.md) ·
[Operations and limits](docs/operations.md) · [Testing](TESTING.md) · [Changelog](CHANGELOG.md)
