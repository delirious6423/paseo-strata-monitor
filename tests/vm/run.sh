#!/usr/bin/env bash
# The plugin's daemon-side discovery, analytics and start/stop on a fresh machine: a disposable Incus
# Ubuntu VM with a Strata-like layout in non-default places (fake Strata CLI/server, no GPU or models).
# Uses the dotfiles Incus harness (DOTFILES_ROOT, default ~/code/dotfiles).  --keep retains the VM.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOTFILES_ROOT="${DOTFILES_ROOT:-$HOME/code/dotfiles}"
# shellcheck source=/dev/null
. "$DOTFILES_ROOT/lib/incus-vm.sh"
KEEP=0
for a in "$@"; do case "$a" in --keep) KEEP=1 ;; *) echo "unknown: $a" >&2; exit 2 ;; esac; done

OUT=$(mktemp -d)
"$ROOT/node_modules/.bin/esbuild" "$ROOT/tests/vm/e2e.ts" --bundle --platform=node --format=esm --target=node20 \
    --outfile="$OUT/e2e.mjs" --log-level=warning
cp -r "$ROOT/tests/vm/fake-strata" "$OUT/"
"$ROOT/node_modules/.bin/esbuild" "$ROOT"/server/*.test.ts --bundle --platform=node --format=esm --target=node20 \
    --outdir="$OUT/unit" --out-extension:.js=.mjs --log-level=warning
mkdir -p "$OUT/tests/vm"
cp -r "$ROOT/tests/vm/fake-strata" "$OUT/tests/vm/"

cleanup() {
    local rc=$?
    rm -rf "$OUT"
    if [ "$rc" != 0 ] || [ "$KEEP" = 0 ]; then incus_vm_delete || exit 1; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

INCUS_PACKAGES="nodejs" incus_vm_start strata-plugin 2048 2 "$ROOT/tests/vm/provision.sh"
"${GUEST[@]}" 'rm -rf /tmp/vm-test && mkdir -p /tmp/vm-test'
tar -C "$OUT" -cf - . | "${GUEST[@]}" 'tar -xf - -C /tmp/vm-test'
"${GUEST[@]}" 'bash -s' < "$ROOT/tests/vm/guest.sh"
