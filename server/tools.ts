import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Job, UpdateCheck } from "../shared/tools";
import { cmdExeLine, discovery, findModel, freeGpu, listEngines, setBusy, strataCommand } from "./control";
import { installPlaces } from "./discover";
import { type Os, cliIn, componentsDir, here, pluginStateDir } from "./places";

// Strata's maintenance tools through its own command-line tool, one at a time (each needs the GPU or the
// engine files): `bench run` against the running model, `tune auto` on a model's run config (saves a preset
// the server applies at every start), and `update` from the signed feed. Progress comes from the files and
// JSON lines Strata writes for its own desktop app; Cancel interrupts the CLI the way Ctrl+C would.

const HISTORY = 20;
const CHECK_TTL_MS = 60 * 60_000;

let os: Os = here();
export const configureTools = (o: Os) => void (os = o);

let current: Job | null = null;
let history: Job[] | null = null;
let child: ChildProcess | null = null;
let lastCheck: UpdateCheck | null = null;
let cancelRequested = false;

const state = () => pluginStateDir(os);
const historyFile = () => join(state(), "jobs.json");

async function loadHistory(): Promise<Job[]> {
  if (history) return history;
  try {
    const v = JSON.parse(await readFile(historyFile(), "utf8"));
    history = Array.isArray(v) ? v.slice(0, HISTORY) : [];
  } catch {
    history = [];
  }
  return history!;
}

async function saveHistory() {
  await mkdir(state(), { recursive: true, mode: 0o700 });
  await writeFile(historyFile(), JSON.stringify(history ?? [], null, 1));
}

export async function toolsStatus() {
  return { job: current, history: await loadHistory(), update: lastCheck };
}

/** The install whose CLI runs the tools: the first Strata install that has one, else Strata on PATH. */
async function toolInstall(): Promise<string> {
  const places = await installPlaces(os);
  return places.find((p) => existsSync(cliIn(p.path, os)))?.path ?? places[0]?.path ?? os.home;
}

/** Start Strata's CLI; every stdout line goes to `onLine`. Resolves with the exit code and the last lines. */
async function launch(args: string[], onLine: (line: string) => void): Promise<{ code: number | null; lines: string[]; err: string }> {
  if (cancelRequested) return { code: 130, lines: [], err: "" }; // cancelled while the tool was still preparing
  const { cmd, env } = strataCommand(await toolInstall());
  const opts = { env: { ...process.env, ...env }, windowsHide: true, detached: !os.windows };
  const p = os.windows && /\.(cmd|bat)$/i.test(cmd)
    ? spawn("cmd.exe", ["/d", "/s", "/c", cmdExeLine(cmd, args)], { ...opts, windowsVerbatimArguments: true })
    : spawn(cmd, args, opts);
  child = p;
  const lines: string[] = [];
  let err = "";
  let buf = "";
  p.stdout?.setEncoding("utf8").on("data", (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      lines.push(line);
      if (lines.length > 200) lines.shift();
      onLine(line);
    }
  });
  p.stderr?.setEncoding("utf8").on("data", (d: string) => (err = (err + d).slice(-2000)));
  return new Promise((done) => {
    p.on("error", (e) => done({ code: -1, lines, err: String(e.message) }));
    p.on("close", (code) => {
      if (buf.trim()) lines.push(buf.trim());
      child = null;
      done({ code, lines, err });
    });
  });
}

const lastJson = (lines: string[]): Record<string, any> | null => {
  for (const l of [...lines].reverse()) {
    try {
      const v = JSON.parse(l);
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
};

/** Ctrl+C for the CLI and everything it started (engines under test); Windows has no SIGINT, so end the tree. */
export async function cancelJob(): Promise<void> {
  const p = child;
  if (!current || current.state !== "running") throw new Error("Nothing is running");
  cancelRequested = true;
  current.message = "Cancelling…";
  if (!p?.pid) return; // still preparing (e.g. stopping the model): the CLI will not be started
  if (os.windows) {
    execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], () => {});
    return;
  }
  try {
    process.kill(-p.pid, "SIGINT");
  } catch {}
  setTimeout(() => {
    if (child === p) try { process.kill(-p.pid!, "SIGKILL"); } catch {}
  }, 30_000).unref();
}

/** Stop the running tool when the plugin unloads, so nothing keeps the GPU without a screen to show it. */
export function disposeTools() {
  if (child?.pid) void cancelJob().catch(() => {});
}

type Runner = (job: Job, poll: (fn: () => Promise<void>) => void) => Promise<void>;

async function startJob(kind: Job["kind"], modelId: string | null, model: string | null, busyAs: string | null, run: Runner) {
  if (current?.state === "running") throw new Error(`${current.kind === "bench" ? "A benchmark" : current.kind === "tune" ? "Autotune" : "An update"} is already running`);
  const job: Job = {
    id: `${Date.now().toString(36)}`, kind, modelId, model, startedMs: Date.now(), endedMs: null, state: "running",
    pct: null, message: "Starting…", minutesLeft: null, outcome: null, details: [], error: null,
  };
  current = job;
  cancelRequested = false;
  if (busyAs) setBusy(busyAs);
  let timer: NodeJS.Timeout | null = null;
  const poll = (fn: () => Promise<void>) => {
    timer = setInterval(() => void fn().catch(() => {}), 1000);
  };
  void (async () => {
    try {
      await run(job, poll);
    } catch (e) {
      job.state = "failed";
      job.error = String((e as Error).message ?? e).slice(0, 500);
    } finally {
      if (timer) clearInterval(timer);
      if (job.state === "running") job.state = "done";
      job.endedMs = Date.now();
      job.minutesLeft = null;
      if (busyAs) setBusy(null);
      const h = await loadHistory();
      h.unshift(job);
      history = h.slice(0, HISTORY);
      if (current === job) current = null;
      await saveHistory().catch(() => {});
    }
  })();
}

const label = (f: { provider: string; quant: string }) => `${f.provider} ${f.quant}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const n = (v: unknown, digits = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "–");

// ------------------------------------------------------------------------------------------- benchmark

/** Strata's bench summary -> one line per measured phase. */
export function benchLines(summary: Record<string, any>): string[] {
  const phases = Array.isArray(summary?.phases) ? summary.phases : [];
  return phases
    .filter((p: any) => p && p.kind !== "warmup")
    .map((p: any) =>
      `${p.kind === "serial" ? "One request" : p.kind === "mixed" ? `${p.client_workers ?? "Several"} at once` : String(p.kind)}: ` +
      `${n(p.output_tok_s)} tok/s, first token ${n(p.p50_ttft_s, 2)} s, answer ${n(p.p50_latency_s)} s` +
      (p.failed ? `, ${p.failed} failed` : ""));
}

export async function startBench(id: string) {
  const f = await findModel(id);
  const e = (await listEngines()).engines.find((x) => x.id === id);
  if (e?.state !== "ready") throw new Error("Load this model first: the benchmark measures the running server");
  const host = f.host && !/^(0\.0\.0\.0|::|\[::\]|localhost)$/.test(f.host) ? f.host : "127.0.0.1";
  const out = join(state(), "bench", `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(f.name)}`);
  await mkdir(join(state(), "bench"), { recursive: true, mode: 0o700 });
  await startJob("bench", id, label(f), "A benchmark", async (job, poll) => {
    job.message = "Warming up";
    poll(async () => {
      const p = JSON.parse(await readFile(join(out, "progress.json"), "utf8"));
      const planned = Array.isArray(p.planned_phases) ? p.planned_phases.length : 0;
      if (planned) job.pct = Math.round((100 * (p.completed_phases ?? 0)) / planned);
      if (p.current_phase && !cancelRequested) job.message = `Measuring: ${p.current_phase}`;
    });
    const r = await launch(["bench", "run", "--url", `http://${host}:${f.port}`, "--suite", "serving-smoke",
      "--condition", "paseo", "--out", out, "--output", "json"], () => {});
    const res = lastJson(r.lines);
    if (cancelRequested) {
      job.state = "cancelled";
      job.outcome = "Cancelled";
      return;
    }
    if (!res?.summary) throw new Error(res?.error?.message ?? (r.err.trim().split("\n").pop() || `exit ${r.code}`));
    job.pct = 100;
    job.details = benchLines(res.summary);
    job.outcome = res.ok ? "Finished" : "Finished with failed requests";
    if (typeof res.path === "string") job.details.push(`Report: ${res.path}`);
  });
}

// ------------------------------------------------------------------------------------------- autotune

const TUNE_OUTCOME: Record<string, string> = {
  improved: "Faster settings found and saved",
  default_confirmed: "Your current settings are already the fastest",
  cancelled: "Cancelled: your settings were not changed",
};

/** Strata's `tune auto` result -> headline and detail lines. */
export function tuneResult(result: Record<string, any> | null, code: number | null): { outcome: string; details: string[]; cancelled: boolean } {
  const outcome = String(result?.outcome ?? (code === 130 ? "cancelled" : "failed"));
  const details: string[] = [];
  if (typeof result?.message === "string") details.push(result.message);
  if (result?.preset?.name) {
    details.push(outcome === "improved"
      ? `Saved as preset "${result.preset.name}"; the server uses it at every start of this model`
      : `Recorded as preset "${result.preset.name}": the standard settings, so nothing changes at start`);
  }
  return { outcome: TUNE_OUTCOME[outcome] ?? "No change was saved", details, cancelled: outcome === "cancelled" };
}

export async function startTune(id: string, mode: "quick" | "thorough") {
  const f = await findModel(id);
  const status = join(state(), "tune-status.json");
  await mkdir(state(), { recursive: true, mode: 0o700 });
  await rm(status, { force: true });
  await startJob("tune", id, label(f), "Autotune", async (job, poll) => {
    job.message = "Stopping the running model";
    await freeGpu();
    job.message = "Measuring your current settings";
    poll(async () => {
      const st = JSON.parse(await readFile(status, "utf8"));
      if (st.runs_planned) job.pct = Math.min(99, Math.round((100 * (st.runs_done ?? 0)) / st.runs_planned));
      if (typeof st.message === "string" && !cancelRequested) job.message = st.message;
      job.minutesLeft = typeof st.minutes_left === "number" ? st.minutes_left : null;
    });
    const r = await launch(["tune", "auto", f.config, "--mode", mode, "--output", "json", "--status-file", status], () => {});
    const res = lastJson(r.lines);
    if (!res?.result && r.code !== 130 && !cancelRequested) throw new Error(res?.error?.message ?? (r.err.trim().split("\n").pop() || `exit ${r.code}`));
    const t = tuneResult(res?.result ?? null, cancelRequested && !res?.result ? 130 : r.code);
    job.outcome = t.outcome;
    job.details = t.details;
    job.pct = 100;
    if (t.cancelled) job.state = "cancelled";
  });
}

// ------------------------------------------------------------------------------------------- update

/** `strata update --check` -> what the screen shows; `reachesModels` from the found models' engine paths. */
export function readCheck(report: Record<string, any>, engines: string[], components: string): UpdateCheck {
  const part = (c: any, offered: unknown) => ({
    installed: typeof c?.installed === "string" ? c.installed : typeof c?.installed?.version === "string" ? c.installed.version : null,
    offered: typeof offered === "string" ? offered : null,
    status: String(c?.status ?? "unknown"),
  });
  const engine = part(report.engine, report.engine?.offered?.version);
  const control = part(report.control, report.control?.offered);
  const root = resolve(components) + sep;
  const bytes = [report.engine, report.control].map((c) => (c && ["install", "update", "available"].includes(c.status) ? c.download_bytes : 0));
  return {
    checkedMs: Date.now(), engine, control,
    downloadBytes: bytes.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0) || null,
    reachesModels: engines.some((e) => resolve(e).startsWith(root)),
    available: [engine.status, control.status].some((s) => s === "install" || s === "update" || s === "available"),
  };
}

export async function checkUpdate(force = false): Promise<UpdateCheck> {
  if (!force && lastCheck && Date.now() - lastCheck.checkedMs < CHECK_TTL_MS) return lastCheck;
  if (current?.kind === "update" && current.state === "running") throw new Error("An update is running");
  const r = await launch(["update", "--check", "--output", "json"], () => {});
  const res = lastJson(r.lines);
  if (!res?.ok) throw new Error(res?.error?.message ?? (r.err.trim().split("\n").pop() || `update check failed (exit ${r.code})`));
  const engines = (await discovery()).models.map((m) => m.engine);
  lastCheck = readCheck(res, engines, componentsDir(os));
  return lastCheck;
}

/** One `strata update --output jsonl` event -> progress on the job. */
export function updateEvent(job: Job, ev: Record<string, any>) {
  if (cancelRequested) return;
  if (ev.event === "progress" && typeof ev.percent === "number") {
    job.pct = ev.percent;
    job.message = `Downloading ${ev.label ?? ev.component ?? ""}`.trim();
  } else if ((ev.event === "phase" || ev.event === "waiting") && typeof ev.message === "string") {
    job.message = ev.message;
  }
}

export async function startUpdate() {
  await startJob("update", null, null, "An update", async (job) => {
    job.message = "Stopping the running model";
    await freeGpu();
    const r = await launch(["update", "--output", "jsonl", "--wait", "0"], (line) => {
      try {
        updateEvent(job, JSON.parse(line));
      } catch {}
    });
    const res = lastJson(r.lines);
    if (cancelRequested && r.code !== 0) {
      job.state = "cancelled";
      job.outcome = "Cancelled: the installed engine was kept";
      return;
    }
    if (!res || !Array.isArray(res.results)) throw new Error(res?.error?.message ?? (r.err.trim().split("\n").pop() || `exit ${r.code}`));
    job.details = res.results.map((x: any) => `${x.component}: ${x.status}${x.version ? ` ${x.version}` : ""}${x.message ? ` (${x.message})` : ""}`);
    job.outcome = res.ok ? "Updated" : "Update finished with problems";
    job.pct = 100;
    lastCheck = null;
  });
}
