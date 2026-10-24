import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job } from "../shared/tools.ts";
import { benchLines, readCheck, tuneResult, updateEvent } from "./tools.ts";

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

test("autotune result: headline per outcome; a preset of standard settings is not called a change", () => {
  const improved = tuneResult({ outcome: "improved", message: "12% faster", preset: { name: "fast" } }, 0);
  assert.equal(improved.outcome, "Faster settings found and saved");
  assert.match(improved.details[1]!, /uses it at every start/);
  const same = tuneResult({ outcome: "default_confirmed", message: "Nothing was changed.", preset: { name: "std" } }, 0);
  assert.equal(same.outcome, "Your current settings are already the fastest");
  assert.match(same.details[1]!, /nothing changes at start/);
  assert.deepEqual(tuneResult(null, 130), { outcome: "Cancelled: your settings were not changed", details: [], cancelled: true });
  assert.equal(tuneResult({ outcome: "weird" }, 6).outcome, "No change was saved");
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
    downloadBytes: 705_432_451, reachesModels: false, available: true,
  });
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
