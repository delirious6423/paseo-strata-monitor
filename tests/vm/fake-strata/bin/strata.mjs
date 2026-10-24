// Stand-in for Strata's CLI in the VM tests: the `profile` and `runtime` subcommands the plugin calls, with
// the same `--output json` shapes as Strata (strata_control/runtime.py). Node only, so it runs on every OS.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const win = process.platform === "win32";
const roaming = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
const PROFILES = process.env.STRATA_PROFILE_DIR || (win ? join(roaming, "Strata", "profiles") : join(homedir(), ".config/strata/profiles"));
const STATE = process.env.STRATA_RUNTIME_DIR || join(homedir(), ".fake-strata-runtime");
const a = process.argv.slice(2);
const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : null);
const out = (o, code = 0) => {
  process.stdout.write(JSON.stringify({ schema_version: 1, ...o }) + "\n");
  process.exit(code);
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const answers = async (port) => fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false);

if (a[0] === "profile" && (a[1] === "create" || a[1] === "use-config")) {
  mkdirSync(PROFILES, { recursive: true });
  writeFileSync(join(PROFILES, `${a[2]}.json`), JSON.stringify({ id: a[2], overrides: {}, schema_version: 1, source_config: arg("--from-config") }));
  out({ ok: true, profile: { id: a[2], source_config: arg("--from-config") } });
}
if (a[0] === "runtime") {
  const name = arg("--profile");
  const pidfile = join(STATE, `${name}.pid`);
  const [pid, port] = existsSync(pidfile) ? readFileSync(pidfile, "utf8").split(" ").map(Number) : [0, 0];
  if (a[1] === "start") {
    const cfg = JSON.parse(readFileSync(join(PROFILES, `${name}.json`), "utf8")).source_config;
    const p = JSON.parse(readFileSync(cfg, "utf8")).port ?? 8095;
    mkdirSync(STATE, { recursive: true });
    const log = openSync(join(STATE, `${name}.log`), "a");
    const child = spawn(process.execPath, [join(here, "serve", "server.py"), "--engine", "strata", "--config", cfg, "--port", String(p)],
      { detached: true, stdio: ["ignore", log, log], windowsHide: true });
    child.unref();
    writeFileSync(pidfile, `${child.pid} ${p}`);
    out({ ok: true, profile: name, state: "starting" });
  }
  if (a[1] === "status") {
    if (!pid || !alive(pid)) out({ ok: true, profile: name, state: "stopped" });
    out({ ok: true, profile: name, state: (await answers(port)) ? "ready" : "starting" });
  }
  if (a[1] === "stop") {
    if (pid && alive(pid)) {
      process.kill(pid);
      for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    }
    rmSync(pidfile, { force: true });
    out({ ok: true, profile: name, state: "stopped" });
  }
}
out({ ok: false, error: { code: 2, message: `unsupported: ${a.join(" ")}` } }, 2);
