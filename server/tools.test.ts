import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job } from "../shared/tools.ts";
import { serverUrl } from "./control.ts";
import { benchLines, readCheck, readPresetStatus, speedChange, tuneReport, updateEvent } from "./tools.ts";

test("benchmark summary: one line per measured phase, warmup left out", () => {
  const lines = benchLines({ phases: [
    { kind: "warmup", output_tok_s: 1 },
    { kind: "serial", client_workers: 1, output_tok_s: 66.12, p50_ttft_s: 0.171, p50_latency_s: 0.52, failed: 0 },
    { kind: "mixed", client_workers: 4, output_tok_s: 61.9, p50_ttft_s: 0.61, p50_latency_s: 0.8, failed: 1 },
  ] });
  assert.deepEqual(lines, [
    "One request: 66.1 tok/s, first token 0.17 s, answer 0.5 s",
    "4 at once: 61.9 tok/s, first token 0.61 s, answer 0.8 s, 1 failed",
  ]);
  assert.deepEqual(benchLines({}), []);
  assert.deepEqual(benchLines({ phases: [{ kind: "serial", output_tok_s: "x" }] }), ["One request: – tok/s, first token – s, answer – s"]);
});

test("autotune report: state and wording from Strata's result, exit code and the presets that appeared", () => {
  const improved = tuneReport({ outcome: "improved", message: "12% faster" }, 0, false, ["fast"]);
  assert.equal(improved.state, "done");
  assert.equal(improved.outcome, "Faster settings found and saved");
  assert.match(improved.details[1]!, /uses it at every start/);
  const same = tuneReport({ outcome: "default_confirmed", message: "Nothing was changed." }, 0, false, ["std"]);
  assert.equal(same.outcome, "Your current settings are already the fastest");
  assert.match(same.details[1]!, /nothing changes at start/);
  // Strata can find faster settings and fail to save them (PresetError): never claim "saved".
  assert.equal(tuneReport({ outcome: "improved" }, 0, false, []).outcome, "Faster settings found, but no preset was saved");
  assert.match(tuneReport({ outcome: "improved" }, 0, false, null).outcome!, /could not confirm/);
  // A tune that failed (exit 6, e.g. the engine would not start) is a failure, not "done".
  const failed = tuneReport({ outcome: "failed", message: "engine did not start" }, 6, false, []);
  assert.equal(failed.state, "failed");
  assert.equal(failed.error, "engine did not start");
  assert.equal(tuneReport(null, 1, false, []).state, "failed");
  // Cancel says what is known, not that nothing changed: a preset saved just before the interrupt is reported.
  assert.equal(tuneReport(null, 130, true, []).outcome, "Cancelled before anything was saved");
  assert.match(tuneReport(null, 130, true, ["late"]).outcome!, /after preset "late" was saved/);
  assert.match(tuneReport(null, null, true, null).outcome!, /could not be checked/);
});

test("benchmark URL: IPv6 hosts in brackets, wildcard hosts as loopback", () => {
  const f = (host: string | null) => serverUrl({ host, port: 8080 } as never);
  assert.equal(f("::1"), "http://[::1]:8080");
  assert.equal(f("0.0.0.0"), "http://127.0.0.1:8080");
  assert.equal(f(null), "http://127.0.0.1:8080");
  assert.equal(f("10.0.0.5"), "http://10.0.0.5:8080");
});

test("update check: versions, download size, and whether the found models would get the new engine", () => {
  const report = {
    engine: { installed: null, offered: { version: "0.1.48" }, status: "install", download_bytes: 606_513_890 },
    control: { installed: "0.1.40", offered: "0.1.49.2", status: "available", download_bytes: 98_918_561 },
  };
  const c = readCheck(report, ["/opt/own/engine/strata"], "/home/u/.local/share/strata/components");
  assert.deepEqual({ ...c, checkedMs: 0 }, {
    checkedMs: 0, engine: { installed: null, offered: "0.1.48", status: "install" },
    control: { installed: "0.1.40", offered: "0.1.49.2", status: "available" },
    downloadBytes: 705_432_451, reachesModels: false, available: true, previous: null,
  });
  // After an update Strata keeps the previous engine: Undo update is offered with it.
  assert.equal(readCheck({ ...report, engine: { ...report.engine, previous: "0.1.47" } }, [], "/c").previous, "0.1.47");
  assert.equal(readCheck(report, ["/home/u/.local/share/strata/components/engine/0.1.40/strata"], "/home/u/.local/share/strata/components").reachesModels, true);
  // A sibling folder whose name merely starts with the components path does not count.
  assert.equal(readCheck(report, ["/home/u/.local/share/strata/components-old/strata"], "/home/u/.local/share/strata/components").reachesModels, false);
  const current = readCheck({ engine: { installed: { version: "0.1.48" }, status: "current" }, control: { status: "current" } }, [], "/c");
  assert.equal(current.available, false);
  assert.equal(current.downloadBytes, null);
});

test("update events: download percent and phase messages become progress", () => {
  const job = { pct: null, message: "" } as unknown as Job;
  updateEvent(job, { event: "progress", percent: 42, label: "engine 0.1.48" });
  assert.deepEqual([job.pct, job.message], [42, "Downloading engine 0.1.48"]);
  updateEvent(job, { event: "phase", phase: "test", message: "Test start of the new engine" });
  assert.equal(job.message, "Test start of the new engine");
  updateEvent(job, { event: "other" });
  assert.equal(job.message, "Test start of the new engine");
});

test("Cancel while a tool is still preparing: the CLI never starts and the job ends cancelled", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { configure } = await import("./control.ts");
  const { cancelJob, configureTools, startUpdate, toolsStatus } = await import("./tools.ts");
  // An empty machine: no models to stop, and no Strata CLI anywhere (PATH is empty), so a started CLI would fail.
  const home = mkdtempSync(join(tmpdir(), "strata-tools-"));
  const o = { windows: false, home, env: { HOME: home, PATH: "" } };
  configure({ extraFolders: [], useSystemd: false }, o);
  configureTools(o);
  try {
    await startUpdate();
    await cancelJob(); // before the CLI exists: the job is still freeing the GPU
    let job = null;
    for (let i = 0; i < 100 && !job; i++) {
      const s = await toolsStatus();
      if (!s.job) job = s.history[0];
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(job?.state, "cancelled", JSON.stringify(job));
    assert.equal(job?.error, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("jobs own their process: an update check during Autotune does not take over Cancel, and a check after a cancel works", async () => {
  const { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { configure } = await import("./control.ts");
  const { cancelJob, changePreset, checkUpdate, configureTools, disposeTools, startBench, startTools, startTune, startUpdate, toolsStatus } = await import("./tools.ts");
  if (process.platform === "win32") return; // the fake CLI is a sh wrapper here; Windows runs it in the VM tests
  const home = mkdtempSync(join(tmpdir(), "strata-tools-"));
  // A Strata install whose CLI is the fake one, with one model (empty GGUF header) it can tune.
  const inst = join(home, "Strata");
  mkdirSync(join(inst, "bin"), { recursive: true });
  writeFileSync(join(inst, "bin", "strata"), `#!/bin/sh\nexec node ${resolve("tests/vm/fake-strata/bin/strata.mjs")} "$@"\n`);
  chmodSync(join(inst, "bin", "strata"), 0o755);
  const header = Buffer.alloc(24);
  header.write("GGUF");
  header.writeUInt32LE(3, 4);
  writeFileSync(join(inst, "tiny-Q4_K_M.gguf"), header);
  writeFileSync(join(inst, "strata-tiny.json"), JSON.stringify({ exe: join(inst, "engine"), args: ["--native", join(inst, "tiny-Q4_K_M.gguf")], model_name: "tiny", port: 8099 }));
  mkdirSync(join(home, ".config", "strata"), { recursive: true });
  writeFileSync(join(home, ".config", "strata", "settings.json"), JSON.stringify({ installs: [inst] }));
  const o = { windows: false, home, env: { HOME: home, PATH: "" } };
  const oldHome = process.env.HOME;
  process.env.HOME = home; // the fake CLI keeps its presets in HOME
  configure({ extraFolders: [], useSystemd: false }, o);
  configureTools(o);
  const { discovery } = await import("./control.ts");
  const id = (await discovery()).models[0]?.id;
  assert.ok(id, "the fixture model is found");
  const ended = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await toolsStatus();
      if (!s.job) return s.history[0];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the job did not end");
  };
  try {
    // Benchmark and Autotune pressed together: the benchmark holds the slot from the press, so Autotune is
    // refused; the benchmark then fails (no model running) and gives the slot back, Load block included.
    const mixed = await Promise.allSettled([startBench(id!), startTune(id!, "quick")]);
    assert.deepEqual(mixed.map((m) => (m.status === "rejected" ? String(m.reason?.message) : "ok")),
      ["Load this model first: the benchmark measures the running server", "A benchmark is already running"]);
    assert.equal((await toolsStatus()).job, null);
    // Two presses at once (two clients): one tune starts, the other is refused.
    const both = await Promise.allSettled([startTune(id!, "quick"), startTune(id!, "quick")]); // the fake tune takes about 5 s
    assert.deepEqual(both.map((b) => b.status).sort(), ["fulfilled", "rejected"]);
    for (let i = 0; i < 100 && !/Round/.test((await toolsStatus()).job?.message ?? ""); i++) await new Promise((r) => setTimeout(r, 100));
    await checkUpdate(true); // a check that starts and ends while Autotune runs
    const t0 = Date.now();
    await cancelJob();
    const job = await ended();
    assert.equal(job?.state, "cancelled", JSON.stringify(job));
    assert.ok(Date.now() - t0 < 4000, "Cancel interrupted the tune itself, not the finished check");
    assert.equal((await checkUpdate(true)).engine.offered, "9.9.9"); // no leftover cancel from the last job
    // Unload, then the host starts the plugin again in the same module instance: the tools work again.
    disposeTools();
    await assert.rejects(checkUpdate(true));
    startTools();
    assert.equal((await checkUpdate(true)).engine.offered, "9.9.9");
    // Saved tuning changes are one at a time, and Autotune does not start while one is being made.
    const two = await Promise.allSettled([changePreset(id!, "off"), changePreset(id!, "off")]);
    assert.deepEqual(two.map((t) => t.status).sort(), ["fulfilled", "rejected"]);
    const changing = changePreset(id!, "off");
    await assert.rejects(startTune(id!, "quick"), /Saved tuning is being changed/);
    await changing;
    // A cancelled update says what is installed now (engine and control are not one transaction).
    await startUpdate();
    for (let i = 0; i < 100 && !/Downloading/.test((await toolsStatus()).job?.message ?? ""); i++) await new Promise((r) => setTimeout(r, 100));
    await cancelJob();
    const upd = await ended();
    assert.equal(upd?.state, "cancelled");
    assert.match(upd?.outcome ?? "", /Installed now: engine/);
  } finally {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("before/after speed: mean of the repeats per kind; changes inside the runs' spread are not called a change", () => {
  const run = (serial: number[], mixed: number[]) => ({ phases: [{ kind: "warmup", output_tok_s: 1 },
    ...serial.map((v) => ({ kind: "serial", output_tok_s: v })), ...mixed.map((v) => ({ kind: "mixed", client_workers: 4, output_tok_s: v }))] });
  // Real Gyro-S numbers: two separate runs of the same settings, 3 repeats each. Neither is a change.
  assert.deepEqual(speedChange(run([74.7, 74.4, 70.1], [77.2, 77.5, 80.7]), run([70.8, 72.8, 66.4], [71.3, 70.2, 73.3])), [
    "One request: 73.1 → 70.0 tok/s (-4.2%, no clear change: under 10%, how much runs of the same settings differed here)",
    "4 at once: 78.5 → 71.6 tok/s (-8.8%, no clear change: under 10%, how much runs of the same settings differed here)",
  ]);
  assert.deepEqual(speedChange(run([60], [50]), run([72], [51])), ["One request: 60.0 → 72.0 tok/s (+20.0%)", "4 at once: 50.0 → 51.0 tok/s (+2.0%, no clear change: under 10%, how much runs of the same settings differed here)"]);
  // Repeats that scatter widely widen the band: 20% apart is not called a change.
  assert.match(speedChange(run([50, 70], [1]), run([66, 74], [1]))[0]!, /\+16\.7%, no clear change: these runs varied by 33%/);
  // Different concurrency is a different workload: not compared.
  assert.deepEqual(speedChange(run([], [60]), { phases: [{ kind: "mixed", client_workers: 8, output_tok_s: 90 }] }), []);
  // A different number of repeats is a different workload: not compared.
  assert.deepEqual(speedChange(run([60, 61, 62], []), run([70], [])), []);
  // A kind missing on one side, or no numbers, is left out rather than compared wrongly.
  assert.deepEqual(speedChange(run([60], []), run([], [9])), []);
  assert.deepEqual(speedChange({}, run([1], [1])), []);
});

test("saved tuning status: Strata's presets status -> the screen's list", () => {
  const st = readPresetStatus({
    ok: true, state: "soft", reasons: ["engine changed"], switched_off: false, can_undo: true,
    presets: [{ id: "abc", name: "Q1_0 64K – Full speed", active: true, created: "2026-10-24T22:50:52+0800", gain_pct: 0, decode_tok_s: 83.9,
      notice: "Answers are identical to the standard setup.", recheck: { last_ok: null, last_result: null } }, { name: "no id" }],
  });
  assert.deepEqual(st, {
    state: "soft", reasons: ["engine changed"], switchedOff: false, canUndo: true,
    presets: [{ id: "abc", name: "Q1_0 64K – Full speed", active: true, created: "2026-10-24T22:50:52+0800", gainPct: 0, decodeTokS: 83.9,
      notice: "Answers are identical to the standard setup.", lastRecheck: null }],
  });
  assert.deepEqual(readPresetStatus({}), { state: null, reasons: [], presets: [], switchedOff: false, canUndo: false });
});
