#!/bin/bash
# Inside the Linux VM, as the test user. e2e.mjs builds the Strata-like machine itself (see e2e.ts).
set -euo pipefail
export XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
node --version
systemctl --user is-system-running || true   # the user manager answers ("running" or "degraded")
cd /tmp/vm-test
node --test unit/*.test.mjs
node e2e.mjs
