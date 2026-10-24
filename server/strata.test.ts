import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotSchema } from "../shared/strata.ts";
import { toSnapshot } from "./strata.ts";

const sample = {
  engine: { model: "m", max_context: 65536 },
  live: { state: "generating", phase: "answering", queued: 0, generated: 455, max_tokens: 4500, elapsed_s: 14.7, tok_s: 56.6, tok_s_mean: 42.5, prefill_tok_s_mean: 252.2 },
  hardware: { gpu_util: 99, gpu_mem_used: 1, gpu_mem_total: 2, gpu_temp: 58, gpu_power: 96.4, cpu: 48.9, ram_used: 3, ram_total: 4 },
  totals: { requests: 3, prompt_tokens: 4595, output_tokens: 8988 },
  requests: [{ time: 1, duration_s: 125.4, finish: "stop", prompt_tokens: 4341, reused: 0, prompt_ms: 3687.8, output_tokens: 4796, decode_tok_s: 39.4 }],
};

test("maps /metrics to a schema-valid snapshot", () => {
  const s = toSnapshot("http://x", sample);
  assert.equal(s.tokS, 56.6);
  assert.equal(s.recent[0]?.outputTokens, 4796);
  assert.equal(s.lastDecodeTokS, 39.4);
  assert.equal(Math.round(s.lastPrefillTokS ?? 0), 1177);
  snapshotSchema.parse(s);
});

test("tolerates missing and hostile fields", () => {
  snapshotSchema.parse(toSnapshot("http://x", { live: { tok_s: "NaN" }, requests: [null, 5], hardware: [] }));
  snapshotSchema.parse(toSnapshot("http://x", null));
});

test("only Strata-shaped /metrics count as a Strata server", async () => {
  const { isStrataMetrics } = await import("./strata.ts");
  assert.ok(isStrataMetrics(sample));
  assert.ok(!isStrataMetrics({ status: "ok" }));
  assert.ok(!isStrataMetrics(null));
});

test("Strata's saved connections: URL + prefix, credential from the named env variable", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { savedConnections } = await import("./strata.ts");
  const home = mkdtempSync(join(tmpdir(), "strata-conn-"));
  const dir = join(home, ".config/strata/connections");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "box.json"), JSON.stringify({ schema_version: 1, id: "box", url: "https://box.example", prefix: "/strata", credential_env: "BOX_KEY" }));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ url: "file:///etc/passwd" }));
  const found = await savedConnections({ windows: false, home, env: { BOX_KEY: "k" } });
  assert.deepEqual(found, [{ url: "https://box.example/strata", key: "k" }]);
});
