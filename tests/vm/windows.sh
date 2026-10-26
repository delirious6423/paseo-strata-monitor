#!/usr/bin/env bash
# The same e2e checks on Windows: x64 in a throwaway copy of the dotfiles native Windows golden VM
# (vm/windows/run.sh), or --arm64 in a throwaway Windows on Arm clone on the iMac (vm/windows-arm/run.sh).
# Portable Node from nodejs.org (SHA-256 checked); the VM is discarded afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOTFILES_ROOT="${DOTFILES_ROOT:-$HOME/code/dotfiles}"
ARCH=x64
[ "${1:-}" != --arm64 ] || ARCH=arm64
NODE=v22.22.1
if [ "$ARCH" = x64 ]; then
    # shellcheck source=/dev/null
    . "$DOTFILES_ROOT/vm/windows/common.sh"
    RUN="$DOTFILES_ROOT/vm/windows/run.sh"
    [ ! -e "$N/run" ] && [ ! -L "$N/run" ] || { echo "A Windows run exists (someone else's?); not touching it" >&2; exit 1; }
else
    # shellcheck source=/dev/null
    . "$DOTFILES_ROOT/vm/windows-arm/common.sh"
    RUN="$DOTFILES_ROOT/vm/windows-arm/run.sh"
    ! running run || { echo "A Windows on Arm run exists; not touching it" >&2; exit 1; }
fi
CACHE="$DATA_DIR/cache/node"
ZIP="$CACHE/node-$NODE-win-$ARCH.zip"
mkdir -p "$CACHE"
if [ ! -f "$ZIP" ]; then
    curl -fsS --max-time 300 -o "$ZIP.part" "https://nodejs.org/dist/$NODE/node-$NODE-win-$ARCH.zip"
    mv "$ZIP.part" "$ZIP"
fi
want=$(curl -fsS --max-time 30 "https://nodejs.org/dist/$NODE/SHASUMS256.txt" | awk -v f="node-$NODE-win-$ARCH.zip" '$2 == f {print $1}')
[ -n "$want" ] && [ "$(sha256sum "$ZIP" | cut -d' ' -f1)" = "$want" ] || { echo "Node zip checksum mismatch" >&2; rm -f "$ZIP"; exit 1; }

OUT=$(mktemp -d)
"$ROOT/node_modules/.bin/esbuild" "$ROOT/tests/vm/e2e.ts" --bundle --platform=node --format=esm --target=node20 \
    --outfile="$OUT/vm-test/e2e.mjs" --log-level=warning
cp -r "$ROOT/tests/vm/fake-strata" "$OUT/vm-test/"
"$ROOT/node_modules/.bin/esbuild" "$ROOT"/server/*.test.ts --bundle --platform=node --format=esm --target=node20 \
    --outdir="$OUT/vm-test/unit" --out-extension:.js=.mjs --log-level=warning
mkdir -p "$OUT/vm-test/tests/vm"
cp -r "$ROOT/tests/vm/fake-strata" "$OUT/vm-test/tests/vm/"
tar -C "$OUT" -cf "$OUT/vm-test.tar" vm-test

OWNED=0
cleanup() {
    rm -rf "$OUT"
    if [ "$OWNED" = 1 ]; then "$RUN" --stop; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

if [ "$ARCH" = x64 ]; then
    "$RUN" > /dev/null
    OWNED=1
    read_reference "$N/run"
    set_ssh "$REF_NAME"
    SCP=(scp -q -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
else
    OWNED=1   # run.sh refuses an existing run, so from here on the run is ours
    "$RUN" > /dev/null
    SCP=(scp -q -J "$MAC" -P "$SSH_PORT" -i "$W/id_test" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes)
fi
"${SCP[@]}" "$ZIP" "$OUT/vm-test.tar" "${SSH[-1]}:"
"${SSH[@]}" '$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Expand-Archive -Force "$HOME\node-'"$NODE"'-win-'"$ARCH"'.zip" "$HOME"
tar -xf "$HOME\vm-test.tar" -C "$HOME"
$env:Path = "$HOME\node-'"$NODE"'-win-'"$ARCH"';" + $env:Path
"Windows " + [Environment]::OSVersion.Version + ", " + $env:PROCESSOR_ARCHITECTURE + ", node " + (node --version)
Set-Location "$HOME\vm-test"
$units = @(Get-ChildItem unit\*.test.mjs | ForEach-Object FullName)
node --test @units
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node e2e.mjs
exit $LASTEXITCODE' | tr -d '\r'
