#!/usr/bin/env bash
# README screenshots from a real Paseo daemon (the Paseo AppImage's own, run as Node) in a throwaway Incus VM:
# the plugin installed from a `git archive` of HEAD (what a public install gets), a demo Strata machine
# (tests/vm/demo.mjs) and the fake Strata CLI/server in demo mode. The daemon serves Paseo's web client; the
# host's Brave (headless, puppeteer-core) opens it at phone and desktop sizes, presses Load and captures.
# Usage: tests/vm/screenshot.sh [--keep]   (PASEO_APPIMAGE, BROWSER, DOTFILES_ROOT may override)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOTFILES_ROOT="${DOTFILES_ROOT:-$HOME/code/dotfiles}"
APPIMAGE="${PASEO_APPIMAGE:-$HOME/Applications/Paseo.AppImage}"
BROWSER="${BROWSER:-$(command -v brave-browser || command -v chromium || command -v google-chrome)}"
# shellcheck source=/dev/null
. "$DOTFILES_ROOT/lib/incus-vm.sh"
KEEP=0
for a in "$@"; do case "$a" in --keep) KEEP=1 ;; *) echo "unknown: $a" >&2; exit 2 ;; esac; done
[ -f "$APPIMAGE" ] || { echo "Paseo AppImage not found: $APPIMAGE" >&2; exit 1; }

OUT=$(mktemp -d)
cleanup() {
    local rc=$?
    rm -rf "$OUT"
    if [ "$rc" != 0 ] || [ "$KEEP" = 0 ]; then incus_vm_delete || exit 1; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

git -C "$ROOT" archive --format=tar --prefix=plugin/ HEAD | tar -xf - -C "$OUT"
cp -r "$ROOT/tests/vm/fake-strata" "$ROOT/tests/vm/demo.mjs" "$OUT/"

# Electron's binary links GTK/NSS even when it runs as Node.
INCUS_PACKAGES="nodejs libnss3 libgtk-3-0t64 libgbm1 libasound2t64" \
    incus_vm_start strata-plugin 4096 2 "$ROOT/tests/vm/provision.sh"
"${GUEST[@]}" 'rm -rf /tmp/shot && mkdir -p /tmp/shot'
tar -C "$OUT" -cf - . | "${GUEST[@]}" 'tar -xf - -C /tmp/shot'
"${GUEST[@]}" 'cat > /tmp/shot/Paseo.AppImage && chmod +x /tmp/shot/Paseo.AppImage' < "$APPIMAGE"
"${GUEST[@]}" 'cd /tmp/shot && ./Paseo.AppImage --appimage-extract >/dev/null && node demo.mjs'
IP=$("${INCUS[@]}" list "$INCUS_VM" -c4 -f csv | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
# Plugins are opt-in in Paseo (Settings → Plugins); a fresh home starts with them on.
"${GUEST[@]}" 'mkdir -p /tmp/shot/home && echo "{\"version\":1,\"pluginsEnabled\":true}" > /tmp/shot/home/config.json'
"${GUEST[@]}" "cd /tmp/shot; PASEO_LISTEN=0.0.0.0:6767 PASEO_HOSTNAMES=$IP PASEO_RELAY_ENABLED=false PASEO_WEB_UI_ENABLED=true \
    PASEO_WEB_UI_DIST_DIR=/tmp/shot/squashfs-root/resources/app-dist STRATA_FAKE_DEMO=1 \
    setsid squashfs-root/resources/bin/paseo daemon run --home /tmp/shot/home > daemon.log 2>&1 < /dev/null &"
for _ in $(seq 60); do curl -sf -m 2 "http://$IP:6767/api/health" >/dev/null && break; sleep 1; done
"${GUEST[@]}" 'cd /tmp/shot && squashfs-root/resources/bin/paseo plugin add /tmp/shot/plugin --home /tmp/shot/home'
"${GUEST[@]}" 'cd /tmp/shot && squashfs-root/resources/bin/paseo plugin ls --home /tmp/shot/home'
node "$ROOT/tests/vm/shoot.mjs" "http://$IP:6767" "$BROWSER" "$ROOT/assets"
