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
  (await import("node:fs")).rmSync(home, { recursive: true, force: true });
  assert.deepEqual(found, [{ url: "https://box.example/strata", key: "k", saved: true }]);
});

test("a saved connection's prefix must be a path: it cannot redirect the host", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { savedConnections } = await import("./strata.ts");
  const home = mkdtempSync(join(tmpdir(), "strata-conn-"));
  const dir = join(home, ".config/strata/connections");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.json"), JSON.stringify({ url: "https://box.example", prefix: "@evil.example", credential_env: "MISSING" }));
  const found = await savedConnections({ windows: false, home, env: {} });
  rmSync(home, { recursive: true, force: true });
  assert.deepEqual(found, [{ url: "https://box.example", key: undefined, saved: true }]);
});

test("credentials: $STRATA_API_KEY only after /health says Strata, never to saved connections; merging keeps keys", async () => {
  const { createServer } = await import("node:http");
  const { fetchMetrics, mergeEndpoints } = await import("./strata.ts");
  const seen: Record<string, (string | undefined)[]> = { decoy: [], strata: [] };
  const serve = (name: string, strata: boolean) =>
    new Promise<{ url: string; close: () => void }>((ok) => {
      const s = createServer((q, r) => {
        seen[name]!.push(q.headers.authorization);
        const body = !strata ? {} : q.url === "/health" ? { service: "strata", loaded: true } : sample;
        r.end(JSON.stringify(body));
      }).listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close() }));
    });
  const decoy = await serve("decoy", false), real = await serve("strata", true);
  process.env.STRATA_API_KEY = "secret";
  try {
    await assert.rejects(fetchMetrics({ url: decoy.url, global: true }), /not a Strata server/);
    assert.deepEqual(seen.decoy, [undefined]);
    await fetchMetrics({ url: real.url, global: true });
    assert.deepEqual(seen.strata, [undefined, "Bearer secret"]); // /health without, /metrics with
    seen.strata = [];
    await fetchMetrics({ url: real.url }); // a saved connection whose credential variable is unset
    assert.deepEqual(seen.strata, [undefined, undefined]);
    // Steady-state polling (verified on the last scan) still checks /health before sending a key: the port
    // may now belong to something else.
    seen.decoy = [];
    await assert.rejects(fetchMetrics({ url: decoy.url, global: true }, true), /not a Strata server/);
    assert.deepEqual(seen.decoy, [undefined]);
  } finally {
    delete process.env.STRATA_API_KEY;
    decoy.close();
    real.close();
  }
  assert.deepEqual(mergeEndpoints([{ url: "u", global: true }, { url: "u", key: "k" }]), [{ url: "u", key: "k", global: true }]);
  // A saved connection's policy wins: its key, or none even where the same URL is also a local port.
  assert.deepEqual(mergeEndpoints([{ url: "u", global: true }, { url: "u", saved: true }]), [{ url: "u", saved: true }]);
  assert.deepEqual(mergeEndpoints([{ url: "u", saved: true, key: "s" }, { url: "u", global: true }]), [{ url: "u", saved: true, key: "s" }]);
});

test("Windows .cmd launcher: paths with spaces quoted; % ! and quotes refused rather than expanded", async () => {
  const { cmdExeLine } = await import("./control.ts");
  assert.equal(cmdExeLine("C:\\S A\\strata.cmd", ["runtime", "C:\\M (x)\\a&b.json"]), '""C:\\S A\\strata.cmd" "runtime" "C:\\M (x)\\a&b.json""');
  for (const bad of ["C:\\%TEMP%\\x.json", "C:\\a!b", 'a"b']) assert.throws(() => cmdExeLine("s.cmd", [bad]), /safely/);
});

test("/health: ready only when it says loaded: true", async () => {
  const { createServer } = await import("node:http");
  const { strataHealth } = await import("./strata.ts");
  const bodies = [{ service: "strata" }, { service: "strata", loaded: "yes" }, { service: "strata", loaded: true }, { loaded: true }];
  let i = 0;
  const s = createServer((_q, r) => r.end(JSON.stringify(bodies[i]))).listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const url = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const got = [];
  for (i = 0; i < bodies.length; i++) got.push(await strataHealth(url));
  s.close();
  assert.deepEqual(got, [{ loaded: false }, { loaded: false }, { loaded: true }, null]);
});
