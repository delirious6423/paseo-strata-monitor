import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { type Job, type PresetStatus, type UpdateCheck, jobSchema } from "../shared/tools";
import { cmdExeLine, discovery, findModel, freeGpu, listEngines, loadForTool, readyModel, serverUrl, setBeforeStop, setBusy, strataCommand } from "./control";
import type { Found } from "./discover";
import { installPlaces } from "./discover";
import { type Os, cliIn, componentsDir, here, pluginStateDir } from "./places";

// Strata's maintenance tools through its own command-line tool, one at a time (each needs the GPU or the
// engine files): `bench run` against the running model, `tune auto` on a model's run config (saves a preset
// the server applies at every start), and `update` from the signed feed. Progress comes from the files and
// JSON lines Strata writes for its own desktop app. Cancel interrupts the CLI the way Ctrl+C would (Windows:
// ends its process tree); what changed anyway is read back from Strata afterwards, never assumed.

const HISTORY = 20;
const CHECK_TTL_MS = 60 * 60_000;

let os: Os = here();
export const configureTools = (o: Os) => void (os = o);
/** Plugin start: undo a previous unload's block (the host may reuse this module instance). */
export const startTools = () => void (disposed = false);

/** The job in progress: its cancel request, the CLI doing the work (`exited` once it ended) and every process
 * it started, helpers included, so Cancel and unload reach all of them. */
type Run = { job: Job; cancel: boolean; procs: Set<ChildProcess>; exited: boolean };
let run: Run | null = null;
let history: Job[] | null = null;
const checks = new Set<ChildProcess>(); // update checks in flight (they are not jobs)
let disposed = false;
let lastCheck: UpdateCheck | null = null;

const state = () => pluginStateDir(os);
const historyFile = () => join(state(), "jobs.json");

async function loadHistory(): Promise<Job[]> {
  if (history) return history;
  try {
    const v = JSON.parse(await readFile(historyFile(), "utf8"));
    // A hand-edited or truncated entry is dropped, not allowed to blank the Tools section.
    history = (Array.isArray(v) ? v : []).flatMap((j) => (jobSchema.safeParse(j).success ? [j] : [])).slice(0, HISTORY);
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
  return { job: run?.job ?? null, history: await loadHistory(), update: lastCheck };
}

/** The CLI for a model: its own install when it has one, else the first Strata install with a CLI (else PATH). */
async function installFor(f?: Found): Promise<string> {
  if (f?.launcher.kind === "strata" && existsSync(cliIn(f.launcher.install, os))) return f.launcher.install;
  const places = await installPlaces(os);
  return places.find((p) => existsSync(cliIn(p.path, os)))?.path ?? places[0]?.path ?? os.home;
}

type Ctx = { stop: () => boolean; started: (p: ChildProcess) => void; done?: (p: ChildProcess) => void; timeoutMs?: number };
type Exit = { code: number | null; lines: string[]; err: string };

/** Start Strata's CLI unless the run was cancelled meanwhile (checked right before spawning). */
async function launch(install: string, args: string[], ctx: Ctx, onLine: (line: string) => void = () => {}): Promise<Exit> {
  const { cmd, env } = strataCommand(install);
  if (ctx.stop() || disposed) return { code: 130, lines: [], err: "" };
  const opts = { env: { ...process.env, ...env }, windowsHide: true, detached: !os.windows };
  const p = os.windows && /\.(cmd|bat)$/i.test(cmd)
    ? spawn("cmd.exe", ["/d", "/s", "/c", cmdExeLine(cmd, args)], { ...opts, windowsVerbatimArguments: true })
    : spawn(cmd, args, opts);
  ctx.started(p);
  // Read-only helpers (preset list, update check) get a time limit: a stalled one must not hold the tools.
  const limit = ctx.timeoutMs ? setTimeout(() => interrupt(p, () => {}), ctx.timeoutMs) : null;
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
  return new Promise((finish) => {
    p.on("error", (e) => finish({ code: -1, lines, err: String(e.message) }));
    p.on("close", (code) => {
      if (limit) clearTimeout(limit);
      if (buf.trim()) lines.push(buf.trim());
      ctx.done?.(p);
      finish({ code, lines, err });
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
const why = (r: Exit, res: Record<string, any> | null) =>
  String(res?.error?.message ?? res?.result?.message ?? (r.err.trim().split("\n").pop() || `exit ${r.code}`)).slice(0, 300);

/** Ctrl+C for the CLI and what it started (engines under test). Windows has no Ctrl+C for another process
 * tree: it is ended outright (Strata keeps the previous engine until a new one passed its test start). */
function interrupt(p: ChildProcess, onError: (msg: string) => void) {
  if (!p.pid) return;
  if (os.windows) {
    execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], (e, _o, stderr) => {
      if (e && p.exitCode === null) onError(String(stderr || e.message).trim().slice(0, 200));
    });
    return;
  }
  try {
    process.kill(-p.pid, "SIGINT");
  } catch {}
  setTimeout(() => {
    if (p.exitCode === null && p.signalCode === null) try { process.kill(-p.pid!, "SIGKILL"); } catch {}
  }, 30_000).unref();
}

export async function cancelJob(): Promise<void> {
  const r = run;
  if (!r || r.job.state !== "running") throw new Error("Nothing is running");
  if (r.exited) {
    // The work itself is over; only a read-back (what was saved or installed) may still run. Stopping it leaves
    // the result marked "could not be checked", never a guess.
    if (!r.procs.size) throw new Error("It has already finished; the result is being saved");
    r.job.message = "Stopping the check…";
    for (const p of r.procs) interrupt(p, (msg) => (r.job.message = `Cancel failed: ${msg}`));
    return;
  }
  r.cancel = true;
  r.job.message = "Cancelling…";
  for (const p of r.procs) interrupt(p, (msg) => (r.job.message = `Cancel failed: ${msg}`));
  // nothing started yet: still preparing, and the CLI will not be started
}

/** Plugin unload: cancel the job (preparing or running) and any update check, so nothing keeps the GPU. */
export function disposeTools() {
  disposed = true;
  if (run) {
    run.cancel = true;
    for (const p of run.procs) interrupt(p, () => {});
  }
  for (const p of checks) interrupt(p, () => {});
}

const busyName = { bench: "A benchmark", tune: "Autotune", update: "An update", recheck: "A preset re-check", rollback: "An engine rollback", idle: "An idle stop" } as const;

/** Claim the one tool slot at once (before anything is awaited, so two presses cannot both get it), run
 * `prepare` (its error goes back to the press, nothing is recorded), then `body` in the background. The slot
 * and the Load block are released only by the run that holds them. */
async function startJob(kind: Job["kind"], modelId: string | null, prepare: () => Promise<Found | null>,
    body: (r: Run, f: Found | null, poll: Poll) => Promise<void>) {
  if (run) throw new Error(`${busyName[run.job.kind]} is already running`);
  const job: Job = {
    id: Date.now().toString(36), kind, modelId, model: null, // the model from the press: Stop finds it while preparing
    startedMs: Date.now(), endedMs: null, state: "running", pct: null, message: "Starting…", minutesLeft: null,
    outcome: null, details: [], error: null,
  };
  const r: Run = { job, cancel: false, procs: new Set(), exited: false };
  run = r;
  setBusy(busyName[kind]);
  const release = () => {
    if (run !== r) return;
    run = null;
    setBusy(null);
  };
  let f: Found | null;
  try {
    f = await prepare();
  } catch (e) {
    release();
    throw e;
  }
  Object.assign(job, { modelId: f?.id ?? null, model: f ? `${f.provider} ${f.quant}` : null });
  const timers = new Set<NodeJS.Timeout>();
  const poll = (fn: () => Promise<void>) => {
    const t = setInterval(() => void fn().catch(() => {}), 1000);
    timers.add(t);
    return () => void (clearInterval(t), timers.delete(t));
  };
  void (async () => {
    try {
      await body(r, f, poll);
    } catch (e) {
      job.state = "failed";
      job.error = String((e as Error).message ?? e).slice(0, 300);
    } finally {
      for (const t of timers) clearInterval(t);
      if (job.state === "running") job.state = "done";
      job.endedMs = Date.now();
      job.minutesLeft = null;
      history = [job, ...(await loadHistory())].slice(0, HISTORY);
      release();
      await saveHistory().catch(() => {});
    }
  })();
}

type Poll = (fn: () => Promise<void>) => () => void;

/** The job's own CLI: Cancel interrupts it. `last`: once this one ended the work is over and Cancel has nothing
 * left to stop (a job of several steps, like autotune with its before/after measurement, passes false). */
const jobCtx = (r: Run, last = true): Ctx => ({ stop: () => r.cancel, started: (p) => r.procs.add(p), done: (p) => {
  r.procs.delete(p);
  if (last) r.exited = true;
} });
/** A short read-only helper for the job (runs also after a cancel, to find out what changed), time-limited. */
const helperCtx = (r: Run): Ctx => ({ stop: () => disposed, started: (p) => r.procs.add(p), done: (p) => r.procs.delete(p), timeoutMs: 60_000 });
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

// Stop on the benchmarked model cancels the benchmark and waits for it to end (Ctrl+C, then a kill after 30 s).
setBeforeStop(async (id) => {
  const r = run;
  if (!r || r.job.kind !== "bench" || r.job.modelId !== id) return;
  await cancelJob().catch(() => {});
  for (let i = 0; i < 350 && run === r; i++) await new Promise((ok) => setTimeout(ok, 100));
  if (run === r) throw new Error("The benchmark of this model is still stopping; try again in a moment");
});

type BenchRun = { summary: Record<string, any>; ok: boolean; path: string | null };

/** One serving-smoke run against the model's server; null when cancelled. `label` prefixes the progress. */
async function runBench(r: Run, f: Found, install: string, poll: Poll, label: string, last: boolean, repeat = 1): Promise<BenchRun | null> {
  const job = r.job;
  const out = join(state(), "bench", `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(f.name)}`);
  await mkdir(join(state(), "bench"), { recursive: true, mode: 0o700 });
  job.message = `${label}Warming up`;
  const stop = poll(async () => {
    const p = JSON.parse(await readFile(join(out, "progress.json"), "utf8"));
    const planned = Array.isArray(p.planned_phases) ? p.planned_phases.length : 0;
    if (planned && !label) job.pct = Math.round((100 * (p.completed_phases ?? 0)) / planned);
    if (p.current_phase && !r.cancel) job.message = `${label}Measuring: ${p.current_phase}`;
  });
  const x = await launch(install, ["bench", "run", "--url", serverUrl(f), "--suite", "serving-smoke",
    "--condition", "paseo", "--repeat", String(repeat), "--out", out, "--output", "json"], jobCtx(r, last));
  stop();
  const res = lastJson(x.lines);
  if (r.cancel) return null;
  if (!res?.summary) throw new Error(why(x, res));
  return { summary: res.summary, ok: !!res.ok, path: typeof res.path === "string" ? res.path : null };
}

/** Before -> after per kind of phase (one request, several at once): the mean output tok/s of each run's
 * repeats. A change inside the spread the repeats themselves show, and at least 10% (separate runs of one
 * model with the same settings differed by up to 9% here), is reported as no clear change. Strata's own `bench compare` refuses runs whose server
 * settings differ, which is exactly what a tune may change, so this is plain arithmetic. */
export function speedChange(before: Record<string, any>, after: Record<string, any>): string[] {
  const byKind = (x: Record<string, any>) => {
    const m = new Map<string, { vals: number[]; workers: unknown }>();
    for (const p of Array.isArray(x?.phases) ? x.phases : []) {
      if (!p || p.kind === "warmup" || typeof p.output_tok_s !== "number" || p.output_tok_s <= 0) continue;
      const e = m.get(p.kind) ?? { vals: [] as number[], workers: p.client_workers as unknown };
      e.vals.push(p.output_tok_s);
      m.set(p.kind, e);
    }
    return m;
  };
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const spread = (v: number[]) => (v.length > 1 ? (100 * (Math.max(...v) - Math.min(...v))) / mean(v) : 0);
  const a = byKind(after);
  return [...byKind(before)].flatMap(([kind, b]) => {
    const now = a.get(kind);
    if (!now) return [];
    const old = mean(b.vals), cur = mean(now.vals);
    const pct = 100 * (cur / old - 1);
    const noise = Math.max(10, spread(b.vals), spread(now.vals));
    const name = kind === "serial" ? "One request" : kind === "mixed" ? `${b.workers ?? "Several"} at once` : kind;
    const verdict = Math.abs(pct) < noise ? `no clear change, runs vary by ±${(noise / 2).toFixed(0)}%` : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    return [`${name}: ${n(old)} → ${n(cur)} tok/s (${verdict})`];
  });
}

/** A measurement the before/after comparison can trust: one throwaway run first (the first requests after a
 * start are slow: 41.6 against 66-73 tok/s steady here), then 3 repeats. */
async function measure(r: Run, f: Found, install: string, poll: Poll, label: string): Promise<BenchRun | null> {
  if (!(await runBench(r, f, install, poll, `${label}warming up · `, false))) return null;
  return runBench(r, f, install, poll, label, false, 3);
}

export async function startBench(id: string) {
  await startJob("bench", id, () => readyModel(id), async (r, model, poll) => {
    const job = r.job;
    const f = model!;
    const b = await runBench(r, f, await installFor(f), poll, "", true);
    if (!b) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled" });
    job.pct = 100;
    job.details = benchLines(b.summary);
    job.outcome = b.ok ? "Finished" : "Finished with failed requests";
    if (b.path) job.details.push(`Report: ${b.path}`);
  });
}

// ------------------------------------------------------------------------------------------- autotune

/** Saved presets (id -> name), or null if Strata could not list them. Read before and after a tune: what a
 * tune saved is what appeared, whatever its output said or failed to say. */
async function presetNames(install: string, r: Run): Promise<Map<string, string> | null> {
  const x = await launch(install, ["presets", "list", "--output", "json"], helperCtx(r)).catch(() => null);
  const res = x && lastJson(x.lines);
  if (!res?.ok || !Array.isArray(res.presets)) return null;
  return new Map(res.presets.flatMap((p: any) => (typeof p?.id === "string" ? [[p.id, String(p.name ?? p.id)]] : [])));
}

/** A finished, cancelled or failed tune -> job state and wording, from Strata's result and the preset list. */
export function tuneReport(result: Record<string, any> | null, code: number | null, cancelled: boolean, saved: string[] | null):
    { state: Job["state"]; outcome: string | null; details: string[]; error: string | null } {
  const outcome = String(result?.outcome ?? "");
  const details: string[] = typeof result?.message === "string" ? [result.message] : [];
  const savedLine = saved?.length
    ? outcome === "default_confirmed"
      ? `Recorded as preset "${saved[0]}": the standard settings, so nothing changes at start`
      : `Saved as preset "${saved[0]}"; the server uses it at every start of this model`
    : null;
  if (savedLine) details.push(savedLine);
  if (cancelled || outcome === "cancelled" || code === 130) {
    const what = saved === null ? "Cancelled; whether a preset was saved could not be checked (strata presets list)"
      : saved.length ? `Cancelled after preset "${saved[0]}" was saved` : "Cancelled before anything was saved";
    return { state: "cancelled", outcome: what, details, error: null };
  }
  if (code === 0 && outcome === "improved") {
    return { state: "done", outcome: saved?.length ? "Faster settings found and saved" : saved === null
      ? "Faster settings found (could not confirm the preset was saved)" : "Faster settings found, but no preset was saved", details, error: null };
  }
  if (code === 0 && outcome === "default_confirmed") return { state: "done", outcome: "Your current settings are already the fastest", details, error: null };
  return { state: "failed", outcome: null, details, error: String(result?.message ?? `autotune ended with exit ${code}`).slice(0, 300) };
}

export async function startTune(id: string, mode: "quick" | "thorough") {
  const status = join(state(), "tune-status.json");
  await startJob("tune", id, () => findModel(id), async (r, model, poll) => {
    const job = r.job;
    const f = model!;
    const install = await installFor(f);
    await mkdir(state(), { recursive: true, mode: 0o700 });
    await rm(status, { force: true });
    // A model that is running is measured before, and started and measured again after: the screen then shows
    // what the tune changed. One that was not running is left stopped.
    const wasReady = (await listEngines(true)).engines.find((e) => e.id === id)?.state === "ready";
    let before: BenchRun | null = null;
    if (wasReady) {
      before = await measure(r, f, install, poll, "Speed before: ").catch((e) => {
        job.details.push(`Speed before: not measured (${String(e.message ?? e).slice(0, 120)})`);
        return null;
      });
    }
    const presetsBefore = await presetNames(install, r);
    if (r.cancel) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled before anything was saved" });
    job.message = "Stopping the running model";
    await freeGpu(() => r.cancel);
    job.message = "Measuring your current settings";
    const stopPoll = poll(async () => {
      const st = JSON.parse(await readFile(status, "utf8"));
      if (st.runs_planned) job.pct = Math.min(99, Math.round((100 * (st.runs_done ?? 0)) / st.runs_planned));
      if (typeof st.message === "string" && !r.cancel) job.message = st.message;
      job.minutesLeft = typeof st.minutes_left === "number" ? st.minutes_left : null;
    });
    const x = await launch(install, ["tune", "auto", f.config, "--mode", mode, "--output", "json", "--status-file", status], jobCtx(r, false));
    stopPoll();
    const cancelled = r.cancel; // a Cancel from here on only skips the "after" measurement
    job.message = "Checking what was saved";
    job.minutesLeft = null;
    const presetsAfter = await presetNames(install, r);
    const result = lastJson(x.lines)?.result ?? null;
    // Strata names the preset it saved; when its output is missing (cancelled late), compare the lists.
    const named = typeof result?.preset?.name === "string" ? [result.preset.name] : null;
    const saved = named ?? (presetsBefore && presetsAfter ? [...presetsAfter].filter(([k]) => !presetsBefore.has(k)).map(([, v]) => v) : null);
    const rep = tuneReport(result, x.code, cancelled, saved);
    const measured = job.details;
    Object.assign(job, rep, { details: [...rep.details, ...measured], pct: rep.state === "done" ? 99 : job.pct });
    if (rep.state === "failed" && !rep.error) job.error = why(x, lastJson(x.lines));
    if (!wasReady) return void (rep.state === "done" && job.details.push("Load the model and press Benchmark to measure it with the new settings"));
    if (cancelled || r.cancel) return void job.details.push("The model was stopped for autotune; press Load to start it again");
    // Put the model back the way it was, now with the saved tuning, and measure again.
    job.message = "Starting the model again";
    try {
      await loadForTool(id, () => r.cancel);
      const after = before && rep.state === "done" ? await measure(r, f, install, poll, "Speed after: ") : null;
      if (before && after) job.details.push(...speedChange(before.summary, after.summary).map((l) => `Speed: ${l}`));
      else if (rep.state === "done" && !r.cancel) job.details.push("Speed after: not compared (no measurement from before)");
    } catch (e) {
      job.details.push(`Not started again: ${String((e as Error).message ?? e).slice(0, 150)}`);
    }
    if (rep.state === "done") job.pct = 100;
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
    previous: typeof report.engine?.previous === "string" ? report.engine.previous : null,
    available: [engine.status, control.status].some((s) => s === "install" || s === "update" || s === "available"),
  };
}

export async function checkUpdate(force = false): Promise<UpdateCheck> {
  if (!force && lastCheck && Date.now() - lastCheck.checkedMs < CHECK_TTL_MS) return lastCheck;
  if (run?.job.kind === "update") throw new Error("An update is running");
  return readInstalled();
}

/** `strata update --check` now (also how a cancelled update finds out what it left installed), time-limited. */
async function readInstalled(r?: Run): Promise<UpdateCheck> {
  const ctx: Ctx = r ? helperCtx(r) : { stop: () => disposed, started: (p) => checks.add(p), done: (p) => checks.delete(p), timeoutMs: 60_000 };
  const x = await launch(await installFor(), ["update", "--check", "--output", "json"], ctx);
  const res = lastJson(x.lines);
  if (!res?.ok) throw new Error(why(x, res));
  const engines = (await discovery()).models.map((m) => m.engine);
  lastCheck = readCheck(res, engines, componentsDir(os));
  return lastCheck;
}

/** One `strata update --output jsonl` event -> progress on the job. */
export function updateEvent(job: Job, ev: Record<string, any>) {
  if (ev.event === "progress" && typeof ev.percent === "number") {
    job.pct = ev.percent;
    job.message = `Downloading ${ev.label ?? ev.component ?? ""}`.trim();
  } else if ((ev.event === "phase" || ev.event === "waiting") && typeof ev.message === "string") {
    job.message = ev.message;
  }
}

export async function startUpdate() {
  await startJob("update", null, async () => null, async (r) => {
    const job = r.job;
    const install = await installFor();
    if (r.cancel) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled before anything started" });
    job.message = "Stopping the running model";
    await freeGpu(() => r.cancel);
    const x = await launch(install, ["update", "--output", "jsonl", "--wait", "0"], jobCtx(r), (line) => {
      try {
        if (!r.cancel) updateEvent(job, JSON.parse(line));
      } catch {}
    });
    const res = lastJson(x.lines);
    lastCheck = null;
    const results = Array.isArray(res?.results) ? res.results : null;
    if (results) job.details = results.map((c: any) => `${c.component}: ${c.status}${c.version ? ` ${c.version}` : ""}${c.error ? ` (${String(c.error).slice(0, 120)})` : ""}`);
    if (r.cancel) {
      // Engine and control install separately and one is not undone if the other stops: say what is installed now.
      job.message = "Checking what is installed now";
      try {
        const now = await readInstalled(r);
        job.outcome = `Cancelled. Installed now: engine ${now.engine.installed ?? "none"}, control ${now.control.installed ?? "none"}`;
      } catch {
        job.outcome = "Cancelled; the installed versions could not be checked (strata update --check)";
      }
      job.state = "cancelled";
      return;
    }
    if (!results) throw new Error(why(x, res));
    job.pct = 100;
    if (res!.ok) job.outcome = "Updated";
    else Object.assign(job, { state: "failed", error: "Some parts did not update; see below (each part is kept or replaced on its own)" });
  });
}

// ------------------------------------------------------------------------------------------- rollback

/** `strata components rollback`: back to the engine version the last update kept (stops whatever runs first). */
export async function startRollback() {
  await startJob("rollback", null, async () => null, async (r) => {
    const job = r.job;
    const install = await installFor();
    if (r.cancel) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled before anything started" });
    job.message = "Stopping the running model";
    await freeGpu(() => r.cancel);
    job.message = "Switching back to the previous engine";
    const x = await launch(install, ["components", "rollback", "--output", "json", "--wait", "0"], jobCtx(r));
    const res = lastJson(x.lines);
    lastCheck = null;
    if (r.cancel) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled; check the installed version with Check for updates" });
    if (!res?.ok) throw new Error(why(x, res));
    job.pct = 100;
    job.outcome = `Engine back to ${res.to ?? "the previous version"}${res.from ? ` (from ${res.from})` : ""}`;
    if (res.presets_marked) job.details.push("Saved presets are marked for a short re-check");
  });
}

// ------------------------------------------------------------------------------------------- presets

const asText = (v: unknown) => (typeof v === "string" ? v : null);
const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `strata presets status <run config> --output json` -> what the screen shows. */
export function readPresetStatus(res: Record<string, any>): PresetStatus {
  const list = Array.isArray(res.presets) ? res.presets : [];
  return {
    state: asText(res.state),
    reasons: Array.isArray(res.reasons) ? res.reasons.map(String).slice(0, 10) : [],
    presets: list.flatMap((p: any) => (typeof p?.id !== "string" ? [] : [{
      id: p.id, name: String(p.name ?? p.id), active: p.active === true, created: asText(p.created),
      gainPct: asNum(p.gain_pct), decodeTokS: asNum(p.decode_tok_s), notice: asText(p.notice),
      lastRecheck: asText(p.recheck?.last_ok) ?? asText(p.recheck?.last_result),
    }])),
    switchedOff: res.switched_off === true,
    canUndo: res.can_undo === true,
  };
}

/** A short, read-only or bookkeeping CLI call outside any job (the presets store has its own lock). */
async function quick(install: string, args: string[]): Promise<Record<string, any>> {
  const x = await launch(install, args, { stop: () => disposed, started: (p) => checks.add(p), done: (p) => checks.delete(p), timeoutMs: 60_000 });
  const res = lastJson(x.lines);
  if (!res?.ok) throw new Error(why(x, res));
  return res;
}

export async function presetStatus(id: string): Promise<PresetStatus> {
  const f = await findModel(id);
  return readPresetStatus(await quick(await installFor(f), ["presets", "status", f.config, "--output", "json"]));
}

export async function changePreset(id: string, action: "off" | "undo" | "apply" | "delete", preset?: string): Promise<PresetStatus> {
  if (run && (run.job.kind === "tune" || run.job.kind === "recheck")) throw new Error(`${busyName[run.job.kind]} is running; wait for it to finish`);
  const f = await findModel(id);
  const install = await installFor(f);
  const known = (await presetStatus(id)).presets;
  if ((action === "apply" || action === "delete") && !known.some((p) => p.id === preset)) throw new Error("That preset is not one of this model's");
  const args = action === "off" ? ["presets", "off", f.config]
    : action === "undo" ? ["presets", "undo", f.config, "--config", f.config]
    : ["presets", action, preset!];
  await quick(install, [...args, "--output", "json"]);
  return presetStatus(id);
}

/** Strata's short re-check that a saved preset is still as fast (needs the GPU: stops whatever runs first). */
export async function startRecheck(id: string, preset: string) {
  const status = join(state(), "recheck-status.json");
  await startJob("recheck", id, () => findModel(id), async (r, model, poll) => {
    const job = r.job;
    const f = model!;
    const install = await installFor(f);
    const p = (await presetStatus(id)).presets.find((x) => x.id === preset);
    if (!p) throw new Error("That preset is not one of this model's");
    await mkdir(state(), { recursive: true, mode: 0o700 });
    await rm(status, { force: true });
    if (r.cancel) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled before anything started" });
    job.message = "Stopping the running model";
    await freeGpu(() => r.cancel);
    job.message = `Re-checking "${p.name}"`;
    poll(async () => {
      const st = JSON.parse(await readFile(status, "utf8"));
      if (st.runs_planned) job.pct = Math.min(99, Math.round((100 * (st.runs_done ?? 0)) / st.runs_planned));
      if (typeof st.message === "string" && !r.cancel) job.message = st.message;
    });
    const x = await launch(install, ["presets", "recheck", preset, f.config, "--output", "json", "--status-file", status], jobCtx(r));
    const res = lastJson(x.lines);
    if (r.cancel) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled; the preset is kept as it was" });
    if (!res?.ok || typeof res.verdict !== "string") throw new Error(why(x, res));
    job.pct = 100;
    job.outcome = res.verdict === "keep" ? `"${p.name}" is still as fast: kept`
      : res.verdict === "retune" ? `"${p.name}" is not as fast as before: run Autotune again`
      : "Could not tell (the PC was busy); kept. Try again later";
    if (typeof res.reason === "string") job.details.push(res.reason);
  });
}

// ------------------------------------------------------------------------------------------- idle stop

/** The idle stop's record in the history (it is not a job; nothing runs). */
export async function recordIdleStop(f: Found, minutes: number) {
  const now = Date.now();
  history = [{
    id: now.toString(36), kind: "idle", modelId: f.id, model: `${f.provider} ${f.quant}`, startedMs: now, endedMs: now,
    state: "done", pct: null, message: "", minutesLeft: null, outcome: `Stopped after ${minutes} min without requests`,
    details: ["Frees the GPU; press Load to start it again"], error: null,
  } satisfies Job, ...(await loadHistory())].slice(0, HISTORY);
  await saveHistory().catch(() => {});
}
