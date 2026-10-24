import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Engine } from "../shared/control";

// Engines are user systemd services: strata@<model> (one per run-<model>.sh, port 8080) and the
// optional EXL3 service (port 8093). Only discovered units are ever started or stopped.
const ROOT = process.env.STRATA_ROOT ?? "/mnt/data4tb/Strata-new";
const EXL3_UNIT = "strata-exl3-quality.service";
const READY_TIMEOUT_MS = 1000;
const STOP_TIMEOUT_MS = 75_000;

type Def = Pick<Engine, "id" | "label" | "unit" | "port">;

function modelName(model: string): string {
  try {
    const name = JSON.parse(readFileSync(join(ROOT, `strata-${model}.json`), "utf8")).model_name;
    if (typeof name === "string") return name;
  } catch {}
  return model;
}

export function discover(): Def[] {
  let files: string[] = [];
  try {
    files = readdirSync(ROOT);
  } catch {}
  const defs: Def[] = files
    .map((f) => /^run-([A-Za-z0-9_.-]+)\.sh$/.exec(f)?.[1])
    .filter((m): m is string => !!m)
    .sort()
    .map((m) => ({ id: m, label: modelName(m), unit: `strata@${m}.service`, port: 8080 }));
  if (existsSync(join(homedir(), ".config/systemd/user", EXL3_UNIT))) {
    defs.push({ id: "exl3-quality", label: "EXL3 2.05-bit (quality)", unit: EXL3_UNIT, port: 8093 });
  }
  return defs;
}

function run(cmd: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim().slice(0, 300)));
      else resolve(stdout);
    });
  });
}

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
    units.set(kv.Id, {
      activeState: kv.ActiveState ?? "unknown",
      result: kv.Result ?? "",
      sinceMs: ts ? Number(ts) * 1000 : null,
    });
  }
  return units;
}

async function answers(port: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), READY_TIMEOUT_MS);
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: abort.signal, redirect: "manual" });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function lastLog(unit: string): Promise<string | null> {
  try {
    const out = await run("journalctl", ["--user", "-u", unit, "-n", "4", "--no-pager", "-o", "cat"]);
    return out.trim().split("\n").slice(-4).join("\n").slice(0, 500) || null;
  } catch {
    return null;
  }
}

export async function listEngines(): Promise<Engine[]> {
  const defs = discover();
  if (defs.length === 0) return [];
  const show = parseShow(
    await run("systemctl", [
      "--user", "show", "--timestamp=unix", "-p", "Id,ActiveState,Result,InactiveExitTimestamp",
      ...defs.map((d) => d.unit),
    ]),
  );
  return Promise.all(
    defs.map(async (d): Promise<Engine> => {
      const u = show.get(d.unit);
      const active = u?.activeState === "active" || u?.activeState === "activating";
      let state: Engine["state"] = "stopped";
      if (active) state = (await answers(d.port)) ? "ready" : "loading";
      else if (u?.activeState === "deactivating") state = "stopping";
      else if (u?.activeState === "failed") state = "failed";
      return {
        ...d,
        state,
        sinceMs: active ? (u?.sinceMs ?? null) : null,
        error: state === "failed" ? ((await lastLog(d.unit)) ?? `exit: ${u?.result}`) : null,
      };
    }),
  );
}

function find(id: string): Def {
  const def = discover().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown Strata engine: ${id}`);
  return def;
}

export async function loadEngine(id: string): Promise<void> {
  const def = find(id);
  const others = (await listEngines()).filter((e) => e.id !== id && e.state !== "stopped" && e.state !== "failed");
  // Blocking stop: the next engine's port check and GPU need the old one fully gone.
  if (others.length) await run("systemctl", ["--user", "stop", ...others.map((e) => e.unit)], STOP_TIMEOUT_MS);
  await run("systemctl", ["--user", "reset-failed", def.unit]).catch(() => {});
  await run("systemctl", ["--user", "start", "--no-block", def.unit]);
}

export async function stopEngine(id: string): Promise<void> {
  const { unit } = find(id);
  await run("systemctl", ["--user", "stop", "--no-block", unit]);
  // Aborting during ExecStartPre marks the unit failed (result 'signal'); a user abort is not a failure.
  // Wait for the stop off the RPC path, then clear that mark.
  void run("systemctl", ["--user", "stop", unit], STOP_TIMEOUT_MS)
    .then(() => run("systemctl", ["--user", "reset-failed", unit]))
    .catch(() => {});
}
