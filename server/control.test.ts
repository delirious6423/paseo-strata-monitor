import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { configure, listEngines, loadEngine, stopEngine } from "./control.ts";

// A machine with one systemd-run model and a fake `systemctl` on PATH: it logs every call, keeps the unit's
// state in a file, and is slow on reset-failed (the window between Load's last check and its start).
const home = mkdtempSync(join(tmpdir(), "strata-ctl-"));
after(() => rmSync(home, { recursive: true, force: true }));
const bin = join(home, "bin");
const units = join(home, ".config", "systemd", "user");
mkdirSync(bin, { recursive: true });
mkdirSync(units, { recursive: true });
writeFileSync(join(home, "m.json"), JSON.stringify({ exe: "e", args: [], model_name: "m", port: 18999 }));
writeFileSync(join(units, "strata-test.service"), `[Service]\nExecStart=/bin/x serve --config ${join(home, "m.json")}\n`);
const log = join(home, "calls"), state = join(home, "state");
writeFileSync(join(bin, "systemctl"), `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *reset-failed*) sleep 1 ;;
  *start*) echo active > "${state}" ;;
  *" stop "*) echo inactive > "${state}" ;;
  *show*) echo "Id=strata-test.service"; echo "ActiveState=$(cat "${state}" 2>/dev/null || echo inactive)"; echo "Result=success"; echo "InactiveExitTimestamp=" ;;
esac
`);
chmodSync(join(bin, "systemctl"), 0o755);
const linux = process.platform === "linux";
const id = "unit:strata-test.service";
const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
const settle = () => new Promise((r) => setTimeout(r, 1500));

function setup() {
  process.env.PATH = `${bin}:${process.env.PATH}`;
  configure({ extraFolders: [], useSystemd: true }, { windows: false, home, env: { HOME: home, PATH: process.env.PATH } });
}

test("systemd: Abort while Load waits in reset-failed: the model never starts", { skip: !linux }, async () => {
  setup();
  assert.deepEqual((await listEngines(true)).engines.map((e) => e.id), [id]);
  writeFileSync(log, "");
  const pending = loadEngine(id);
  await new Promise((r) => setTimeout(r, 400)); // Load is inside the slow reset-failed now
  await stopEngine(id);
  await pending;
  await settle();
  assert.doesNotMatch(calls(), /\bstart\b/, calls());
  assert.equal(readFileSync(state, "utf8").trim(), "inactive");
});

test("systemd: one Stop cancels every Load requested before it; a later Load starts", { skip: !linux }, async () => {
  setup();
  writeFileSync(log, "");
  const loads = [loadEngine(id), loadEngine(id)];
  await stopEngine(id);
  await Promise.all(loads);
  await settle();
  assert.doesNotMatch(calls(), /\bstart\b/, calls());
  await loadEngine(id);
  assert.match(calls(), /start --no-block -- strata-test\.service/);
  await stopEngine(id);
  await settle();
});
