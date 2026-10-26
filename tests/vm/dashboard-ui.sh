#!/usr/bin/env bash
# Real Paseo + Chromium both run in an owned disposable VM; host only drives DevTools.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "${DOTFILES_ROOT:-$HOME/code/dotfiles}/lib/incus-vm.sh"
OUT=$(mktemp -d)
RESULTS="${DATA_DIR:-/mnt/data4tb}/strata-dashboard-tests/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS" "$OUT/plugin"
cleanup() { local rc=$?; if [ "$rc" != 0 ] && [ "${#GUEST[@]}" -gt 0 ]; then "${GUEST[@]}" 'df -h /tmp; du -sh /home/tester/strata-dashboard-ui/* 2>/dev/null; tail -15 /home/tester/strata-dashboard-ui/daemon.log /home/tester/strata-dashboard-ui/browser.log 2>/dev/null' || true; fi; rm -rf "$OUT"; incus_vm_delete || exit 1; exit "$rc"; }
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
(cd "$ROOT" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf - --) | tar -xf - -C "$OUT/plugin"
cp -r "$ROOT/tests/vm/fake-strata" "$ROOT/tests/vm/demo.mjs" "$OUT/"
INCUS_PACKAGES="nodejs libnss3 libgtk-3-0t64 libgbm1 libasound2t64" incus_vm_start strata-dashboard-ui 8192 2 "$ROOT/tests/vm/provision.sh"
"${GUEST[@]}" 'mkdir -p /home/tester/strata-dashboard-ui'
tar -C "$OUT" -cf - . | "${GUEST[@]}" 'tar -xf - -C /home/tester/strata-dashboard-ui'
"${GUEST[@]}" 'cat > /home/tester/strata-dashboard-ui/Paseo.AppImage && chmod +x /home/tester/strata-dashboard-ui/Paseo.AppImage' < "${PASEO_APPIMAGE:-$HOME/Applications/Paseo.AppImage}"
tar -C /opt/brave.com -cf - brave | "${GUEST[@]}" 'tar -xf - -C /home/tester/strata-dashboard-ui'
"${GUEST[@]}" 'cd /home/tester/strata-dashboard-ui && ./Paseo.AppImage --appimage-extract >/dev/null && rm Paseo.AppImage && node demo.mjs && mkdir home && printf "%s\n" "{\"version\":1,\"pluginsEnabled\":true}" > home/config.json'
IP=$("${INCUS[@]}" list "$INCUS_VM" -c4 -f csv | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
"${GUEST[@]}" "cd /home/tester/strata-dashboard-ui; PASEO_LISTEN=0.0.0.0:6767 PASEO_HOSTNAMES=$IP PASEO_RELAY_ENABLED=false PASEO_WEB_UI_ENABLED=true PASEO_WEB_UI_DIST_DIR=/home/tester/strata-dashboard-ui/squashfs-root/resources/app-dist STRATA_FAKE_DEMO=1 setsid squashfs-root/resources/bin/paseo daemon run --home /home/tester/strata-dashboard-ui/home > daemon.log 2>&1 < /dev/null &"
for _ in $(seq 60); do curl -sf -m 2 "http://$IP:6767/api/health" >/dev/null && break; sleep 1; done
"${GUEST[@]}" 'cd /home/tester/strata-dashboard-ui && squashfs-root/resources/bin/paseo plugin add /home/tester/strata-dashboard-ui/plugin --home /home/tester/strata-dashboard-ui/home'
"${GUEST[@]}" 'cd /home/tester/strata-dashboard-ui; setsid brave/brave --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --remote-debugging-port=9222 --remote-allow-origins="*" --user-data-dir=/home/tester/strata-dashboard-ui/browser-profile about:blank > browser.log 2>&1 < /dev/null &'
"${GUEST[@]}" 'cd /home/tester/strata-dashboard-ui; setsid node -e '\''require("net").createServer(s=>{const t=require("net").connect(9222,"127.0.0.1");s.pipe(t);t.pipe(s);t.on("error",()=>s.destroy());s.on("error",()=>t.destroy());}).listen(9223,"0.0.0.0")'\'' > proxy.log 2>&1 < /dev/null &'
for _ in $(seq 30); do curl -sf -m 2 "http://$IP:9223/json/version" >/dev/null && break; sleep 1; done
node "$ROOT/tests/vm/dashboard-ui.mjs" "http://$IP:6767" "http://$IP:9223" "$RESULTS"
printf 'UI evidence: %s\n' "$RESULTS"
