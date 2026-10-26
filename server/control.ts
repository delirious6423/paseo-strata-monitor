import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Engine } from "../shared/control";
import { type Discovery, type Found, discover } from "./discover";
import { recentListeners } from "./listeners";
import { type Os, cliIn, here, profileDir } from "./places";
import { expectServer, invalidateServers, strataHealth } from "./strata";

// Start/stop through what already owns a model: its systemd user unit (Linux), else Strata's own
// `profile` + `runtime` commands (all platforms), using plugin-owned profiles named `paseo-<model>`.

const DISCOVERY_TTL_MS = 30_000;
const STOP_TIMEOUT_MS = 90_000;
const PROBE_MS = 1000;

export type Options = { extraFolders: string[]; useSystemd: boolean };
let options: Options = { extraFolders: [], useSystemd: true };
let os: Os = here();
export function configure(next: Partial<Options>, o?: Os) {
  options = { ...options, ...next };
  if (o) os = o;
  cached = null;
}

let cached: { at: number; value: Promise<Discovery> } | null = null;
export function discovery(rescan = false): Promise<Discovery> {
  if (!rescan && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
  const value = discover(os, { extraFolders: options.extraFolders, systemd: options.useSystemd });
  cached = { at: Date.now(), value };
  value.catch(() => (cached = null));
  return value;
}

/** The `cmd.exe /s /c` line for a .cmd launcher. cmd.exe expands %VAR% and !VAR! even inside quotes and has
 * no reliable escape there, so arguments with those (or a quote / line break) are refused, never mangled. */
export function cmdExeLine(cmd: string, args: string[]): string {
  const bad = [cmd, ...args].find((a) => /[%!"\r\n]/.test(a));
  if (bad !== undefined) throw new Error(`Cannot pass ${JSON.stringify(bad)} to ${cmd} safely (it contains % ! or a quote); rename that path`);
  return `"${[cmd, ...args].map((a) => `"${a}"`).join(" ")}"`;
}

function run(cmd: string, args: string[], timeout = 15_000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const done = (error: Error | null, stdout: string, stderr: string) => {
      if (error && !stdout.trim().startsWith("{")) reject(new Error((stderr || error.message).trim().slice(0, 300)));
      else resolveRun(stdout); // Strata's --output json reports errors in stdout with a non-zero exit
    };
    if (os.windows && /\.(cmd|bat)$/i.test(cmd)) {
      let line: string;
      try {
        line = cmdExeLine(cmd, args);
      } catch (e) {
        return reject(e);
      }
      execFile("cmd.exe", ["/d", "/s", "/c", line],
        { timeout, maxBuffer: 1 << 20, windowsVerbatimArguments: true, windowsHide: true, env: env && { ...process.env, ...env } }, done);
    } else {
      execFile(cmd, args, { timeout, maxBuffer: 1 << 20, env: env && { ...process.env, ...env } }, done);
    }
  });
}

const json = (out: string): Record<string, any> => {
  try {
    return JSON.parse(out.trim().split("\n").pop() ?? "{}");
  } catch {
    return {};
  }
};

// ------------------------------------------------------------------------------------------- systemd

type Unit = { activeState: string; result: string; sinceMs: number | null };

/** Parse `systemctl show --timestamp=unix -p Id,ActiveState,Result,InactiveExitTimestamp` for several units. */
export function parseShow(out: string): Map<string, Unit> {
  const units = new Map<string, Unit>();
  for (const block of out.split(/\n\s*\n/)) {
    const kv = Object.fromEntries(
      block.split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    if (!kv.Id) continue;
    const ts = /^@(\d+)$/.exec(kv.InactiveExitTimestamp ?? "")?.[1];
    units.set(kv.Id, { activeState: kv.ActiveState ?? "unknown", result: kv.Result ?? "", sinceMs: ts ? Number(ts) * 1000 : null });
  }
  return units;
}

async function lastLog(unit: string): Promise<string | null> {
  const out = await run("journalctl", ["--user", `--unit=${unit}`, "-n", "4", "--no-pager", "-o", "cat"]).catch(() => "");
  return out.trim().split("\n").slice(-4).join("\n").slice(0, 500) || null;
}

// ------------------------------------------------------------------------------------------- Strata runtime

const profileName = (f: Found) => `paseo-${f.id.replace(/^cfg:/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`.slice(0, 63);

/** A source checkout keeps Strata's packages in .venv; bin/strata would otherwise use a bare `python3` from PATH. */
function cliEnv(install: string): Record<string, string> | undefined {
  if (os.env.STRATA_PYTHON) return undefined;
  const venv = os.windows ? join(install, ".venv", "Scripts", "python.exe") : join(install, ".venv", "bin", "python");
  return existsSync(venv) ? { STRATA_PYTHON: venv } : undefined;
}

/** Run Strata's command-line tool of `install`. */
const strata = (install: string, args: string[], timeout?: number) => run(cli(install), args, timeout, cliEnv(install));

function cli(install: string): string {
  const own = cliIn(install, os);
  if (existsSync(own)) return own;
  const exe = os.windows ? ["strata.cmd", "strata.exe"] : ["strata"];
  for (const dir of (os.env.PATH ?? "").split(os.windows ? ";" : ":")) {
    for (const e of exe) if (dir && existsSync(join(dir, e))) return join(dir, e);
  }
  throw new Error(`Strata's command-line tool was not found in ${install}/bin or on PATH`);
}

function savedProfileSource(name: string): string | null {
  try {
    const p = JSON.parse(readFileSync(join(profileDir(os), `${name}.json`), "utf8"));
    if (typeof p.source_config !== "string" || !p.source_config) throw new Error("Invalid saved profile");
    return p.source_config;
  } catch {
    if (existsSync(join(profileDir(os), `${name}.json`))) throw new Error("Cannot read the saved Strata profile; model state is unknown");
    return null;
  }
}

async function runtimeState(f: Found & { launcher: { kind: "strata" } }): Promise<{ state: Engine["state"]; error: string | null }> {
  const name = profileName(f);
  if (!savedProfileSource(name)) return { state: "stopped", error: null };
  const r = json(await strata(f.launcher.install, ["runtime", "status", "--profile", name, "--output", "json"]));
  const s = r.state;
  if (s === "ready") return { state: "ready", error: null };
  if (s === "starting") return { state: "loading", error: null };
  if (s === "failed") return { state: "failed", error: String(r.error ?? r.message ?? s).slice(0, 300) };
  if (s === "stopped" && r.ok === true) return { state: "stopped", error: null };
  return { state: "unknown", error: "Strata runtime status could not establish the model state" };
}

async function ensureProfile(f: Found & { launcher: { kind: "strata" } }): Promise<string> {
  const name = profileName(f);
  const have = savedProfileSource(name);
  if (have && resolve(have) === resolve(f.config)) return name;
  const verb = have ? "use-config" : "create";
  const r = json(await strata(f.launcher.install, ["profile", verb, name, "--from-config", f.config, "--output", "json"]));
  if (!r.ok) throw new Error(`Strata profile ${verb} failed: ${r.error?.message ?? r.error ?? "unknown error"}`);
  return name;
}

// ------------------------------------------------------------------------------------------- engines

const stopping = new Set<string>();

/** Ready = a Strata server on that port says its engine is loaded (not merely: something answers HTTP). */
/** The model's server root: its configured host unless that is a wildcard, IPv6 in brackets. */
export const serverUrl = (f: Found) => {
  const h = f.host && !/^(0\.0\.0\.0|::|\[::\]|localhost)$/.test(f.host) ? f.host : "127.0.0.1";
  return `http://${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}:${f.port}`;
};
const answers = async (f: Found) => (await strataHealth(serverUrl(f), PROBE_MS))?.loaded === true;

const launcherLabel = (f: Found) => (f.launcher.kind === "systemd" ? `systemd ${f.launcher.unit}` : `Strata runtime (${profileName(f)})`);

/** A model that holds (or is taking/releasing) its port and the GPU. Failed and stopped ones do not. */
const owns = (e: Engine) => e.state !== "stopped" && e.state !== "failed";

/** Strata servers on this machine that no active model accounts for: local listeners owned by a Strata server
 * process, each confirmed by /health. The screen's warning and Load's refusal both use this one rule; the
 * listing reuses a scan for 10 s (a process listing is PowerShell/lsof on Windows/macOS), Load scans fresh. */
async function elsewhere(engines: Engine[], fresh = false): Promise<{ url: string; model: string | null }[]> {
  const ours = new Set(engines.filter(owns).map((e) => e.port));
  const urls = (await recentListeners(fresh ? 0 : 10_000)).filter((p) => !ours.has(p)).map((p) => `http://127.0.0.1:${p}`);
  const health = await Promise.all(urls.map((u) => strataHealth(u, PROBE_MS)));
  return urls.flatMap((url, i) => (health[i] ? [{ url, model: null }] : []));
}

// Several clients poll every 1-3 s; one listing serves them all for a moment (Strata's CLI is a Python start).
const LIST_MS = 1500;
let listing: { at: number; value: Promise<Listing> } | null = null;
type Listing = { engines: Engine[]; places: Discovery["places"]; elsewhere: { url: string; model: string | null }[] };
export function listEngines(rescan = false): Promise<Listing> {
  if (!rescan && listing && Date.now() - listing.at < LIST_MS) return listing.value;
  const value = listNow(rescan);
  listing = { at: Date.now(), value };
  value.catch(() => (listing = null));
  return value;
}

async function listNow(rescan: boolean): Promise<Listing> {
  const d = await discovery(rescan);
  const units = d.models.flatMap((f) => (f.launcher.kind === "systemd" ? [f.launcher.unit] : []));
  const show = units.length
    ? parseShow(await run("systemctl", ["--user", "show", "--timestamp=unix", "-p", "Id,ActiveState,Result,InactiveExitTimestamp", "--", ...units]).catch(() => ""))
    : new Map<string, Unit>();
  const engines = await Promise.all(
    d.models.map(async (f): Promise<Engine> => {
      let state: Engine["state"] = "stopped";
      let error: string | null = null;
      let sinceMs: number | null = null;
      if (f.launcher.kind === "systemd") {
        const u = show.get(f.launcher.unit);
        const active = u?.activeState === "active" || u?.activeState === "activating";
        if (!u || !["active", "activating", "deactivating", "failed", "inactive"].includes(u.activeState)) {
          state = "unknown";
          error = "Systemd status could not establish the model state";
        }
        if (active) state = (await answers(f)) ? "ready" : "loading";
        else if (u?.activeState === "deactivating") state = "stopping";
        else if (u?.activeState === "failed") state = "failed";
        sinceMs = active ? (u?.sinceMs ?? null) : null;
        if (state === "failed") error = (await lastLog(f.launcher.unit)) ?? `exit: ${u?.result}`;
      } else {
        ({ state, error } = await runtimeState(f as Found & { launcher: { kind: "strata" } }).catch((e) => ({ state: "unknown" as const, error: String(e.message ?? e) })));
      }
      if (stopping.has(f.id)) state = "stopping"; // cleared when `runtime stop` returns
      if (stopErrors.has(f.id) && state !== "stopped") error = `Stop failed: ${stopErrors.get(f.id)}`;
      return {
        id: f.id, name: f.name, family: f.family, provider: f.provider, quant: f.quant, format: f.format, sizeBytes: f.sizeBytes,
        port: f.port, config: f.config, launcher: launcherLabel(f), source: f.source, keepsTuning: f.keepsTuning, state, sinceMs, error,
      };
    }),
  );
  return { engines, places: d.places, elsewhere: await elsewhere(engines, rescan) };
}

async function find(id: string): Promise<Found> {
  const f = (await discovery()).models.find((m) => m.id === id);
  if (!f) throw new Error(`Unknown Strata model: ${id}`);
  return f;
}

async function stopNow(f: Found): Promise<void> {
  if (f.launcher.kind === "systemd") {
    await run("systemctl", ["--user", "stop", "--", f.launcher.unit], STOP_TIMEOUT_MS);
    return;
  }
  const r = json(await strata(f.launcher.install, ["runtime", "stop", "--profile", profileName(f), "--wait", "85", "--output", "json"], STOP_TIMEOUT_MS));
  if (r.ok !== true) throw new Error(`Strata runtime stop failed: ${r.error?.message ?? r.error ?? r.state ?? "no answer"}`);
}

// One load/stop at a time (several clients may press buttons), and Stop cancels a Load still preparing.
let queue: Promise<unknown> = Promise.resolve();
export const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
};
// Every Stop bumps its model's generation; a Load only starts if no Stop came after it was requested
// (checked again right before each start step), so an Abort always wins, however the steps interleave.
const generation = new Map<string, number>();
const gen = (id: string) => generation.get(id) ?? 0;
const stopErrors = new Map<string, string>();


// A long tool run (autotune, update) owns the GPU and the engine files: no Load meanwhile.
let busy: string | null = null;
export const setBusy = (reason: string | null) => void (busy = reason);
export const isBusy = () => busy !== null;

/** Stop every model that holds the GPU, through the same lock as Load/Stop; refuses if a foreign Strata server
 * runs (it would hold the GPU too). For tools that need the whole GPU. */
export function freeGpu(aborted: () => boolean = () => false): Promise<void> {
  return exclusive(async () => {
    if (aborted()) return;
    const { engines } = await listNow(false);
    const foreign = await elsewhere(engines, true);
    if (foreign.length) throw new Error(`A Strata server this plugin did not start is running at ${foreign.map((s) => s.url).join(", ")}; stop it first`);
    for (const e of engines.filter(owns)) {
      const f = await find(e.id);
      if (aborted()) return; // cancelled meanwhile: leave the user's model running
      generation.set(e.id, gen(e.id) + 1); // a queued Load must not start it again
      await stopNow(f);
    }
  }).finally(() => invalidateServers());
}

export { find as findModel };

/** The model is ready, checked under the Load/Stop lock: after any Load queued earlier has run. The caller
 * has already marked the tools busy, so no later Load can switch it underneath. */
export function readyModel(id: string): Promise<Found> {
  return exclusive(async () => {
    const f = await find(id);
    const e = (await listNow(false)).engines.find((x) => x.id === id);
    if (e?.state !== "ready") throw new Error("Load this model first: the benchmark measures the running server");
    return f;
  });
}

/** Strata's command-line tool for an install, with the environment it needs (a source checkout's .venv). */
export const strataCommand = (install: string) => ({ cmd: cli(install), env: cliEnv(install) });

/** For the tool that holds the tools slot (autotune's "after" measurement): start a model and wait until it
 * is ready. Stop still wins (generation), and so does the tool's own Cancel. */
export async function loadForTool(id: string, aborted: () => boolean, timeoutMs = 15 * 60_000): Promise<void> {
  stopErrors.delete(id);
  const asked = gen(id);
  const stopped = () => aborted() || gen(id) !== asked;
  await exclusive(() => load(id, stopped, true)).finally(() => invalidateServers());
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((ok) => setTimeout(ok, 2000))) {
    if (stopped()) throw new Error("stopped before it was ready");
    const e = (await listNow(false)).engines.find((x) => x.id === id);
    if (e?.state === "ready") return;
    if (e?.state === "failed" || e?.state === "stopped") throw new Error(e.error ?? `the model ${e.state === "failed" ? "failed to start" : "did not start"}`);
  }
  throw new Error(`the model was not ready after ${Math.round(timeoutMs / 60_000)} min`);
}

/** Where Strata's runtime keeps a profile's server log (strata_control/runtime.py: state_base()/runtime). */
function runtimeLog(f: Found): string {
  const env = os.env;
  const base = env.STRATA_RUNTIME_DIR ?? (os.windows
    ? join(env.LOCALAPPDATA ?? join(os.home, "AppData", "Local"), "Strata", "runtime")
    : join(env.XDG_STATE_HOME ?? join(os.home, ".local", "state"), "strata", "runtime"));
  return join(base, `${profileName(f)}.server.log`);
}

/** The last lines a model's server wrote while starting or serving: its unit's journal, or Strata's runtime log. */
export async function engineLog(id: string, lines = 40): Promise<{ source: string; lines: string[] }> {
  const f = await find(id);
  if (f.launcher.kind === "systemd") {
    const out = await run("journalctl", ["--user", `--unit=${f.launcher.unit}`, "-n", String(lines), "--no-pager", "-o", "short-iso"]).catch((e) => String(e.message ?? e));
    return { source: `journalctl --user -u ${f.launcher.unit}`, lines: out.split("\n").filter((l) => l.trim()).slice(-lines) };
  }
  const path = runtimeLog(f);
  const fh = await open(path, "r").catch(() => null);
  if (!fh) return { source: path, lines: [] };
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, 64 << 10); // the tail only: a long-running server's log grows
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const all = buf.toString("utf8").split(/\r?\n/).filter((l) => l.trim());
    return { source: path, lines: all.slice(size > len ? 1 : 0).slice(-lines) }; // a cut first line is dropped
  } finally {
    await fh.close();
  }
}

export function loadEngine(id: string): Promise<void> {
  if (busy) return Promise.reject(new Error(`${busy} is running; cancel it or wait for it to finish`));
  stopErrors.delete(id);
  const asked = gen(id);
  return exclusive(() => load(id, () => gen(id) !== asked)).finally(() => invalidateServers());
}

async function load(id: string, aborted: () => boolean, forTool = false): Promise<void> {
  if (busy && !forTool) throw new Error(`${busy} is running; cancel it or wait for it to finish`); // admitted before it began
  const f = await find(id);
  const { engines } = await listNow(false); // fresh, not the shared cache
  const active = engines.filter(owns);
  if (engines.find(e => e.id === id)?.state === "unknown") throw new Error("Model state is unknown. Use Stop / recover unknown model, then search again before loading.");
  const foreign = await elsewhere(engines, true);
  if (foreign.length) throw new Error(`A Strata server this plugin did not start is running at ${foreign.map((s) => s.url).join(", ")}; stop it first (one model at a time)`);
  // Blocking: the next model's port and GPU need the old one fully gone. A failed stop aborts the load.
  for (const o of active.filter((e) => e.id !== id)) await stopNow(await find(o.id));
  if (active.some((e) => e.id === id) || aborted()) return;
  if (f.launcher.kind === "systemd") {
    await run("systemctl", ["--user", "reset-failed", "--", f.launcher.unit]).catch(() => {});
    if (aborted()) return;
    await run("systemctl", ["--user", "start", "--no-block", "--", f.launcher.unit]);
    expectServer(f.port);
    return;
  }
  const name = await ensureProfile(f as Found & { launcher: { kind: "strata" } });
  if (aborted()) return;
  const r = json(await strata(f.launcher.install, ["runtime", "start", "--profile", name, "--wait", "0", "--output", "json"], 60_000));
  if (!r.ok) throw new Error(`Strata runtime start failed: ${r.error?.message ?? r.error ?? r.state ?? "unknown error"}`);
  expectServer(f.port);
}

/** Called before a Stop: a tool working on that model (a benchmark) is cancelled first. */
let beforeStop: (id: string) => Promise<void> = async () => {};
export const setBeforeStop = (fn: (id: string) => Promise<void>) => void (beforeStop = fn);

export async function stopEngine(id: string): Promise<void> {
  await beforeStop(id);
  generation.set(id, gen(id) + 1); // every Load requested before now will not start this model
  stopErrors.delete(id);
  const f = await find(id);
  stopping.add(id);
  if (f.launcher.kind === "systemd") {
    // Immediate (kills a start in progress); the queued blocking stop below also catches a start that slipped in.
    await run("systemctl", ["--user", "stop", "--no-block", "--", f.launcher.unit]).catch(() => {});
  }
  void exclusive(async () => {
    await stopNow(f);
    // Aborting during ExecStartPre marks the unit failed (result 'signal'); a user abort is not a failure.
    if (f.launcher.kind === "systemd") await run("systemctl", ["--user", "reset-failed", "--", f.launcher.unit]).catch(() => {});
  })
    .catch((e) => stopErrors.set(id, String(e.message ?? e).slice(0, 300)))
    .finally(() => {
      stopping.delete(id);
      invalidateServers();
    });
}

/** Every configured port: the analytics try these besides the servers they find listening. */
export async function knownPorts(): Promise<number[]> {
  return [...new Set((await discovery()).models.map((m) => m.port))];
}
