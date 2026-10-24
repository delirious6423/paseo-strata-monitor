// JavaScript, run by node, named like Strata's serve/server.py so its command line looks like a Strata server
// to the plugin's listener scan. Stand-in for the VM tests: after a simulated 2 s load it serves / and a
// Strata-shaped /health and /metrics on --port.
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");

const argv = process.argv;
const config = JSON.parse(readFileSync(argv[argv.indexOf("--config") + 1], "utf8"));
const port = argv.includes("--port") ? Number(argv[argv.indexOf("--port") + 1]) : (config.port ?? 8095);

setTimeout(() => {
  createServer((req, res) => {
    const body = req.url === "/metrics"
      ? { engine: { model: config.model_name, max_context: 4096 }, live: { state: "idle", queued: 0 }, hardware: {}, totals: { requests: 0 }, requests: [] }
      : req.url === "/health" ? { status: "ok", service: "strata", loaded: true, model: config.model_name } : { ok: true };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }).listen(port, "127.0.0.1");
}, 2000);
