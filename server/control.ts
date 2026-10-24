import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Engine } from "../shared/control";
import { type Discovery, type Found, discover } from "./discover";
import { type Os, cliIn, here, profileDir } from "./places";

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

function run(cmd: string, args: string[], timeout = 15_000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const done = (error: Error | null, stdout: string, stderr: string) => {
      if (error && !stdout.trim().startsWith("{")) reject(new Error((stderr || error.message).trim().slice(0, 300)));
      else resolveRun(stdout); // Strata's --output json reports errors in stdout with a non-zero exit
    };
    if (os.windows && /\.(cmd|bat)$/i.test(cmd)) {
      const q = (a: string) => `"${a.replace(/"/g, '""')}"`;
      execFile("cmd.exe", ["/d", "/s", "/c", `"${[cmd, ...args].map(q).join(" ")}"`],
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
  const out = await run("journalctl", ["--user", "-u", unit, "-n", "4", "--no-pager", "-o", "cat"]).catch(() => "");
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
    return typeof p.source_config === "string" ? p.source_config : null;
  } catch {
    return null;
  }
}

async function runtimeState(f: Found & { launcher: { kind: "strata" } }): Promise<{ state: Engine["state"]; error: string | null }> {
  const name = profileName(f);
  if (!savedProfileSource(name)) return { state: "stopped", error: null };
  const r = json(await strata(f.launcher.install, ["runtime", "status", "--profile", name, "--output", "json"]).catch(() => "{}"));
  const s = r.state;
  if (s === "ready") return { state: "ready", error: null };
  if (s === "starting") return { state: "loading", error: null };
  if (s === "failed" || s === "stale") return { state: "failed", error: String(r.error ?? r.message ?? s).slice(0, 300) };
  return { state: "stopped", error: null };
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

async function answers(port: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_MS);
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: abort.signal, redirect: "manual" });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const launcherLabel = (f: Found) => (f.launcher.kind === "systemd" ? `systemd ${f.launcher.unit}` : `Strata runtime (${profileName(f)})`);

export async function listEngines(rescan = false): Promise<{ engines: Engine[]; places: Discovery["places"] }> {
  const d = await discovery(rescan);
  const units = d.models.flatMap((f) => (f.launcher.kind === "systemd" ? [f.launcher.unit] : []));
  const show = units.length
    ? parseShow(await run("systemctl", ["--user", "show", "--timestamp=unix", "-p", "Id,ActiveState,Result,InactiveExitTimestamp", ...units]).catch(() => ""))
    : new Map<string, Unit>();
  const engines = await Promise.all(
    d.models.map(async (f): Promise<Engine> => {
      let state: Engine["state"] = "stopped";
      let error: string | null = null;
      let sinceMs: number | null = null;
      if (f.launcher.kind === "systemd") {
        const u = show.get(f.launcher.unit);
        const active = u?.activeState === "active" || u?.activeState === "activating";
        if (active) state = (await answers(f.port)) ? "ready" : "loading";
        else if (u?.activeState === "deactivating") state = "stopping";
        else if (u?.activeState === "failed") state = "failed";
        sinceMs = active ? (u?.sinceMs ?? null) : null;
        if (state === "failed") error = (await lastLog(f.launcher.unit)) ?? `exit: ${u?.result}`;
      } else {
        ({ state, error } = await runtimeState(f as Found & { launcher: { kind: "strata" } }).catch((e) => ({ state: "failed" as const, error: String(e.message ?? e) })));
      }
      if (stopping.has(f.id)) state = "stopping"; // cleared when `runtime stop` returns
      return {
        id: f.id, name: f.name, family: f.family, provider: f.provider, quant: f.quant, format: f.format, sizeBytes: f.sizeBytes,
        port: f.port, config: f.config, launcher: launcherLabel(f), source: f.source, state, sinceMs, error,
      };
    }),
  );
  return { engines, places: d.places };
}

async function find(id: string): Promise<Found> {
  const f = (await discovery()).models.find((m) => m.id === id);
  if (!f) throw new Error(`Unknown Strata model: ${id}`);
  return f;
}

async function stopNow(f: Found): Promise<void> {
  if (f.launcher.kind === "systemd") await run("systemctl", ["--user", "stop", f.launcher.unit], STOP_TIMEOUT_MS);
  else await strata(f.launcher.install, ["runtime", "stop", "--profile", profileName(f), "--wait", "85", "--output", "json"], STOP_TIMEOUT_MS);
}

export async function loadEngine(id: string): Promise<void> {
  const f = await find(id);
  const { engines } = await listEngines();
  const others = engines.filter((e) => e.id !== id && e.state !== "stopped" && e.state !== "failed");
  // Blocking: the next model's port and GPU need the old one fully gone.
  for (const o of others) await stopNow(await find(o.id));
  if (f.launcher.kind === "systemd") {
    await run("systemctl", ["--user", "reset-failed", f.launcher.unit]).catch(() => {});
    await run("systemctl", ["--user", "start", "--no-block", f.launcher.unit]);
    return;
  }
  const name = await ensureProfile(f as Found & { launcher: { kind: "strata" } });
  const r = json(await strata(f.launcher.install, ["runtime", "start", "--profile", name, "--wait", "0", "--output", "json"], 60_000));
  if (!r.ok) throw new Error(`Strata runtime start failed: ${r.error?.message ?? r.error ?? r.state ?? "unknown error"}`);
}

export async function stopEngine(id: string): Promise<void> {
  const f = await find(id);
  if (f.launcher.kind === "systemd") {
    const unit = f.launcher.unit;
    await run("systemctl", ["--user", "stop", "--no-block", unit]);
    // Aborting during ExecStartPre marks the unit failed (result 'signal'); a user abort is not a failure.
    void run("systemctl", ["--user", "stop", unit], STOP_TIMEOUT_MS)
      .then(() => run("systemctl", ["--user", "reset-failed", unit]))
      .catch(() => {});
    return;
  }
  stopping.add(id);
  void stopNow(f).catch(() => {}).finally(() => stopping.delete(id));
}

/** Every configured port: the analytics try these besides the servers they find listening. */
export async function knownPorts(): Promise<number[]> {
  return [...new Set((await discovery()).models.map((m) => m.port))];
}
