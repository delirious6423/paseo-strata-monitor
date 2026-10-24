# Testing

## Unit tests (host)

`npm test`: parsers (GGUF header, systemd `ExecStart`, launch scripts, `/proc/net/tcp`, `lsof`), discovery on
fixture machines (Linux settings file, Windows `%APPDATA%`/`%LOCALAPPDATA%`, `STRATA_INSTALL_DIR`, systemd
template and plain units, extra folders, split GGUFs, HF cache), picker order, saved connections.

## End-to-end in throwaway VMs

`tests/vm/e2e.ts` runs the plugin's daemon-side code (discovery, start/stop, analytics) on a machine that has
never seen the author's setup. It builds a Strata-like layout in the OS's own places: Strata's settings file
naming an install in a folder with a space in its name, GGUF files with real headers, a template systemd user
unit whose script uses `$HOME` (Linux), and an unrelated HTTP server that must be ignored. The fake Strata CLI
and server (`tests/vm/fake-strata`, Node only) speak the same `profile`/`runtime` JSON and `/metrics` shape as
Strata. Analytics get no configured ports, so they must find servers by scanning listeners. 16 checks.

The VM runners come from the dotfiles repo (`DOTFILES_ROOT`, default `~/code/dotfiles`); each refuses to touch an
existing run and discards its own VM afterwards.

| Target | Command | Last result (2026-10-24) |
|---|---|---|
| Linux x64 | `tests/vm/run.sh` (Incus, Ubuntu 26.04, Node 22 from apt) | PASS 16/16 |
| Linux ARM64 | `tests/vm/macos.sh linux-arm` (Tart on Apple Silicon, Ubuntu) | PASS 16/16 |
| Windows x64 | `tests/vm/windows.sh` (Incus, Windows 11 26300) | PASS 16/16 |
| Windows ARM64 | `tests/vm/windows.sh --arm64` (QEMU/hvf on Apple Silicon) | PASS 16/16 |
| macOS ARM64 | `tests/vm/macos.sh` (Tart, macOS 26.6) | PASS 16/16 |

Not covered by the VMs: the real Strata CLI and engine (no GPU or models in a VM; the real `profile`/`runtime`
path was run on the author's Linux machine with a real model, as were the systemd path and analytics), and the
Paseo app UI itself (no automated UI test; check the Strata screen and settings by hand after UI changes).
