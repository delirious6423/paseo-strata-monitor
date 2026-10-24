// JavaScript, run by node, named like Strata's serve/server.py so its command line looks like a Strata server
// to the plugin's listener scan. Stand-in for the VM tests: after a simulated 2 s load it serves / and a
// Strata-shaped /health and /metrics on --port.
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");

const argv = process.argv;
const config = JSON.parse(readFileSync(argv[argv.indexOf("--config") + 1], "utf8"));
const port = argv.includes("--port") ? Number(argv[argv.indexOf("--port") + 1]) : (config.port ?? 8095);

// STRATA_FAKE_DEMO=1 (screenshots only): a model answering a request, with made-up but plausible numbers.
const t0 = Date.now();
function demo() {
  const t = (Date.now() - t0) / 1000;
  const now = Date.now() / 1000;
  const req = (ago, dur, p, o, tok) => ({ time: now - ago, duration_s: dur, finish: "stop", prompt_tokens: p, reused: 0, prompt_ms: p / 0.9, output_tokens: o, decode_tok_s: tok });
  return {
    engine: { model: config.model_name, max_context: 65536 },
    live: { state: "generating", phase: "answering", queued: 0, generated: Math.round(40 * t) % 1800, max_tokens: 4096, elapsed_s: t % 45,
      tok_s: 38 + 6 * Math.sin(t / 3), tok_s_mean: 39.2, prefill_tok_s_mean: 905 },
    hardware: { gpu_util: 97, gpu_temp: 66, gpu_power: 118, gpu_mem_used: 15.1 * 2 ** 30, gpu_mem_total: 16 * 2 ** 30, cpu: 41, ram_used: 52 * 2 ** 30, ram_total: 64 * 2 ** 30 },
    totals: { requests: 14, prompt_tokens: 61240, output_tokens: 23310 },
    requests: [req(30, 48.2, 5120, 1840, 40.1), req(140, 61.5, 9300, 2210, 38.7), req(420, 22.9, 2210, 860, 41.3)],
  };
}

setTimeout(() => {
  createServer((req, res) => {
    const body = req.url === "/metrics"
      ? (process.env.STRATA_FAKE_DEMO ? demo() : { engine: { model: config.model_name, max_context: 4096 }, live: { state: "idle", queued: 0 }, hardware: {}, totals: { requests: 0 }, requests: [] })
      : req.url === "/health" ? { status: "ok", service: "strata", loaded: true, model: config.model_name } : { ok: true };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }).listen(port, "127.0.0.1");
}, 2000);
