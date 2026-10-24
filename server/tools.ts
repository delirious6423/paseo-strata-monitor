import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { type Job, type UpdateCheck, jobSchema } from "../shared/tools";
import { cmdExeLine, discovery, findModel, freeGpu, readyModel, serverUrl, setBeforeStop, setBusy, strataCommand } from "./control";
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
export const configureTools = (o: Os) => {
  os = o;
  disposed = false; // a reload into the same module instance starts fresh
};

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
  if (r.exited) throw new Error("It has already finished; the result is being saved"); // not a cancel any more
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

const busyName = { bench: "A benchmark", tune: "Autotune", update: "An update" } as const;

/** Claim the one tool slot at once (before anything is awaited, so two presses cannot both get it), run
 * `prepare` (its error goes back to the press, nothing is recorded), then `body` in the background. The slot
 * and the Load block are released only by the run that holds them. */
async function startJob(kind: Job["kind"], prepare: () => Promise<Found | null>,
    body: (r: Run, f: Found | null, poll: (fn: () => Promise<void>) => void) => Promise<void>) {
  if (run) throw new Error(`${busyName[run.job.kind]} is already running`);
  const job: Job = {
    id: Date.now().toString(36), kind, modelId: null, model: null,
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
  let timer: NodeJS.Timeout | null = null;
  const poll = (fn: () => Promise<void>) => void (timer = setInterval(() => void fn().catch(() => {}), 1000));
  void (async () => {
    try {
      await body(r, f, poll);
    } catch (e) {
      job.state = "failed";
      job.error = String((e as Error).message ?? e).slice(0, 300);
    } finally {
      if (timer) clearInterval(timer);
      if (job.state === "running") job.state = "done";
      job.endedMs = Date.now();
      job.minutesLeft = null;
      history = [job, ...(await loadHistory())].slice(0, HISTORY);
      release();
      await saveHistory().catch(() => {});
    }
  })();
}

/** The job's own CLI: Cancel interrupts it; once it ended, Cancel has nothing left to stop. */
const jobCtx = (r: Run): Ctx => ({ stop: () => r.cancel, started: (p) => r.procs.add(p), done: (p) => {
  r.procs.delete(p);
  r.exited = true;
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

export async function startBench(id: string) {
  await startJob("bench", () => readyModel(id), async (r, model, poll) => {
    const job = r.job;
    const f = model!;
    const out = join(state(), "bench", `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(f.name)}`);
    await mkdir(join(state(), "bench"), { recursive: true, mode: 0o700 });
    job.message = "Warming up";
    poll(async () => {
      const p = JSON.parse(await readFile(join(out, "progress.json"), "utf8"));
      const planned = Array.isArray(p.planned_phases) ? p.planned_phases.length : 0;
      if (planned) job.pct = Math.round((100 * (p.completed_phases ?? 0)) / planned);
      if (p.current_phase && !r.cancel) job.message = `Measuring: ${p.current_phase}`;
    });
    const x = await launch(await installFor(f), ["bench", "run", "--url", serverUrl(f), "--suite", "serving-smoke",
      "--condition", "paseo", "--out", out, "--output", "json"], jobCtx(r));
    const res = lastJson(x.lines);
    if (r.cancel) {
      job.state = "cancelled";
      job.outcome = "Cancelled";
      return;
    }
    if (!res?.summary) throw new Error(why(x, res));
    job.pct = 100;
    job.details = benchLines(res.summary);
    job.outcome = res.ok ? "Finished" : "Finished with failed requests";
    if (typeof res.path === "string") job.details.push(`Report: ${res.path}`);
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
  await startJob("tune", () => findModel(id), async (r, model, poll) => {
    const job = r.job;
    const f = model!;
    const install = await installFor(f);
    await mkdir(state(), { recursive: true, mode: 0o700 });
    await rm(status, { force: true });
    const before = await presetNames(install, r);
    if (r.cancel) return void Object.assign(job, { state: "cancelled", outcome: "Cancelled before anything started" });
    job.message = "Stopping the running model";
    await freeGpu(() => r.cancel);
    job.message = "Measuring your current settings";
    poll(async () => {
      const st = JSON.parse(await readFile(status, "utf8"));
      if (st.runs_planned) job.pct = Math.min(99, Math.round((100 * (st.runs_done ?? 0)) / st.runs_planned));
      if (typeof st.message === "string" && !r.cancel) job.message = st.message;
      job.minutesLeft = typeof st.minutes_left === "number" ? st.minutes_left : null;
    });
    const x = await launch(install, ["tune", "auto", f.config, "--mode", mode, "--output", "json", "--status-file", status], jobCtx(r));
    job.message = "Checking what was saved";
    const after = await presetNames(install, r);
    const result = lastJson(x.lines)?.result ?? null;
    // Strata names the preset it saved; when its output is missing (cancelled late), compare the lists.
    const named = typeof result?.preset?.name === "string" ? [result.preset.name] : null;
    const saved = named ?? (before && after ? [...after].filter(([k]) => !before.has(k)).map(([, v]) => v) : null);
    const rep = tuneReport(result, x.code, r.cancel, saved);
    Object.assign(job, rep, { pct: rep.state === "done" ? 100 : job.pct });
    if (rep.state === "failed" && !rep.error) job.error = why(x, lastJson(x.lines));
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
  await startJob("update", async () => null, async (r) => {
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
