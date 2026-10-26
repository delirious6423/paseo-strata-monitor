#!/usr/bin/env bash
# The same e2e checks on the Apple Silicon Mac's Tart VMs: macOS ARM64 (dotfiles vm/macos/run.sh), or with
# `linux-arm` Ubuntu ARM64 (vm/linux-arm/run.sh). Portable Node from nodejs.org (SHA-256 checked); the
# throwaway clone is deleted afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOTFILES_ROOT="${DOTFILES_ROOT:-$HOME/code/dotfiles}"
NODE=v22.22.1
if [ "${1:-}" = linux-arm ]; then
    export MAC_IMAGE=ghcr.io/cirruslabs/ubuntu:latest MAC_BASE=ubuntu-base MAC_VM=linux-run
    RUN="$DOTFILES_ROOT/vm/linux-arm/run.sh" PLATFORM=linux-arm64 EXT=tar.xz
else
    RUN="$DOTFILES_ROOT/vm/macos/run.sh" PLATFORM=darwin-arm64 EXT=tar.gz
fi
# shellcheck source=/dev/null
. "$DOTFILES_ROOT/vm/macos/common.sh"
TGZ="$DATA_DIR/cache/node/node-$NODE-$PLATFORM.$EXT"

! mac "tart list -q --source local" | grep -qx "$NAME" || { echo "A macOS run ($NAME) exists; not touching it" >&2; exit 1; }
mkdir -p "$(dirname "$TGZ")"
[ -f "$TGZ" ] || { curl -fsS --max-time 300 -o "$TGZ.part" "https://nodejs.org/dist/$NODE/$(basename "$TGZ")" && mv "$TGZ.part" "$TGZ"; }
want=$(curl -fsS --max-time 30 "https://nodejs.org/dist/$NODE/SHASUMS256.txt" | awk -v f="$(basename "$TGZ")" '$2 == f {print $1}')
[ -n "$want" ] && [ "$(sha256sum "$TGZ" | cut -d' ' -f1)" = "$want" ] || { echo "Node checksum mismatch" >&2; rm -f "$TGZ"; exit 1; }

OUT=$(mktemp -d)
"$ROOT/node_modules/.bin/esbuild" "$ROOT/tests/vm/e2e.ts" --bundle --platform=node --format=esm --target=node20 \
    --outfile="$OUT/vm-test/e2e.mjs" --log-level=warning
cp -r "$ROOT/tests/vm/fake-strata" "$OUT/vm-test/"
"$ROOT/node_modules/.bin/esbuild" "$ROOT"/server/*.test.ts --bundle --platform=node --format=esm --target=node20 \
    --outdir="$OUT/vm-test/unit" --out-extension:.js=.mjs --log-level=warning
mkdir -p "$OUT/vm-test/tests/vm"
cp -r "$ROOT/tests/vm/fake-strata" "$OUT/vm-test/tests/vm/"

OWNED=0
cleanup() {
    rm -rf "$OUT"
    if [ "$OWNED" = 1 ]; then "$RUN" --stop; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

OWNED=1   # from here on this run owns $NAME (run.sh refuses an existing one)
"$RUN" > /dev/null
vm_ssh 'cat > node.tar' < "$TGZ"
tar -C "$OUT" -cf - vm-test | vm_ssh 'tar -xf -'
vm_ssh 'set -e; tar -xf node.tar; export PATH="$HOME/node-'"$NODE-$PLATFORM"'/bin:$PATH"
echo "$(uname -s) $(uname -r), $(uname -m), node $(node --version), arch $(node -p process.arch)"
[ "$(node -p process.arch)" = arm64 ]
file "$(command -v node)"
if [ "$(uname -s)" = Linux ]; then
    export XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
fi
cd vm-test
node --test unit/*.test.mjs
node e2e.mjs'
