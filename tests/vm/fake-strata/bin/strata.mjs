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
// The maintenance tools, with the output shapes of strata bench/tune/update (strata_cli/bench.py,
// tune_commands.py, update_cmd.py). Each takes a few seconds; Ctrl+C ends them the way Strata does.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let interrupted = false;
process.on("SIGINT", () => (interrupted = true));
const PRESETS = join(homedir(), ".fake-strata-presets.json");
const presets = () => (existsSync(PRESETS) ? JSON.parse(readFileSync(PRESETS, "utf8")) : []);
if (a[0] === "presets" && a[1] === "list") out({ ok: true, presets: presets() });
if (a[0] === "bench" && a[1] === "run") {
  const dir = arg("--out");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const phases = ["warmup", "serial", "mixed"];
  const progress = (done, current, state = "running") => writeFileSync(join(dir, "progress.json"), JSON.stringify({
    schema_version: 1, kind: "strata.serving.benchmark.progress", suite: "serving-smoke", state,
    planned_phases: phases, completed_phases: done, current_phase: current }));
  for (let i = 0; i < phases.length; i++) {
    progress(i, phases[i]);
    await sleep(1000);
    if (interrupted) out({ ok: false, error: { code: 130, message: "benchmark cancelled" } }, 130);
  }
  progress(3, null, "report_saved");
  writeFileSync(join(dir, "results.json"), "{}");
  out({ ok: true, path: join(dir, "results.json"), summary: { suite: "serving-smoke", successful: true, phases: [
    { kind: "warmup", client_workers: 1, output_tok_s: 10, p50_ttft_s: 0.5, p50_latency_s: 1, failed: 0 },
    { kind: "serial", client_workers: 1, output_tok_s: 42.5, p50_ttft_s: 0.2, p50_latency_s: 2.1, failed: 0 },
    { kind: "mixed", client_workers: 4, output_tok_s: 120.4, p50_ttft_s: 0.6, p50_latency_s: 3.3, failed: 0 }] } });
}
if (a[0] === "tune" && a[1] === "auto") {
  const status = arg("--status-file");
  const planned = 8;
  for (let i = 0; i <= planned; i++) {
    writeFileSync(status, JSON.stringify({ state: "running", stage: "round", message: `Round ${i} of ${planned}`, runs_done: i,
      runs_planned: planned, minutes_left: Math.max(1, planned - i) }));
    await sleep(600);
    if (interrupted) {
      const result = { outcome: "cancelled", message: "Stopped. Your settings were not changed.", preset: null };
      writeFileSync(status, JSON.stringify({ state: "done", result }));
      out({ ok: true, result }, 130);
    }
  }
  const preset = { id: `p${Date.now()}`, name: `fake 64K – Full speed ${presets().length + 1}`, active: true };
  writeFileSync(PRESETS, JSON.stringify([...presets(), preset]));
  const result = { outcome: "improved", message: "8% faster than your settings.", preset: { id: preset.id, name: preset.name } };
  writeFileSync(status, JSON.stringify({ state: "done", result }));
  out({ ok: true, result });
}
if (a[0] === "update" && a.includes("--check")) {
  out({ ok: true, engine: { installed: null, offered: { version: "9.9.9" }, status: "install", download_bytes: 5_000_000 },
    control: { installed: "1.0", offered: "1.1", status: "available", download_bytes: 1_000_000 } });
}
if (a[0] === "update") {
  for (let pct = 0; pct <= 100; pct += 25) {
    process.stdout.write(JSON.stringify({ schema_version: 1, event: "progress", phase: "download", component: "engine", label: "engine 9.9.9", percent: pct, done: pct, total: 100 }) + "\n");
    await sleep(400);
    if (interrupted) out({ ok: false, exit_code: 130, results: [{ component: "engine", status: "cancelled" }] }, 130);
  }
  process.stdout.write(JSON.stringify({ schema_version: 1, event: "phase", phase: "test", message: "Test start of the new engine" }) + "\n");
  await sleep(400);
  out({ ok: true, exit_code: 0, results: [{ component: "engine", status: "updated", version: "9.9.9" }, { component: "control", status: "updated", version: "1.1" }] });
}
out({ ok: false, error: { code: 2, message: `unsupported: ${a.join(" ")}` } }, 2);
