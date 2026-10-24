// Runs inside a disposable VM (bundled to plain JS; needs only Node): the plugin's daemon-side code on a
// machine that has never seen the author's setup. It builds a Strata-like layout in the OS's own places
// (Strata settings file, an install elsewhere, GGUF files; on Linux also a user systemd template unit), with
// the fake Strata CLI/server from fake-strata/. Prints PASS/FAIL per check; exit code = number of failures.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configure, engineLog, listEngines, loadEngine, stopEngine } from "../../server/control";
import { configureIdle, idleTick } from "../../server/idle";
import { strataListeners } from "../../server/listeners";
import { configureEndpoints, getSnapshot } from "../../server/strata";
import {
  cancelJob, changePreset, checkUpdate, presetStatus, startBench, startRecheck, startRollback, startTune, startUpdate, toolsStatus,
} from "../../server/tools";
import { groupEngines } from "../../shared/group";

const win = process.platform === "win32";
const linux = process.platform === "linux";
const home = homedir();
const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- the machine
const settingsDir = win ? join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Strata") : join(home, ".config", "strata");
const app = join(home, "Strata Apps", "strata"); // a space: Windows .cmd quoting must hold
const models = join(home, "Models");
for (const d of [settingsDir, app, models]) mkdirSync(d, { recursive: true });
cpSync(join(here, "fake-strata"), app, { recursive: true });
if (!win) chmodSync(join(app, "bin", "strata"), 0o755);
writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ installs: [app], data_dir: models }));

const str = (s: string) => {
  const b = Buffer.from(s);
  const n = Buffer.alloc(8);
  n.writeBigUInt64LE(BigInt(b.length));
  return Buffer.concat([n, b]);
};
function gguf(file: string, kvs: [string, string][], pad = 0) {
  const head = Buffer.alloc(24);
  head.write("GGUF", 0, "latin1");
  head.writeUInt32LE(3, 4);
  head.writeBigUInt64LE(0n, 8);
  head.writeBigUInt64LE(BigInt(kvs.length), 16);
  const t = Buffer.alloc(4);
  t.writeUInt32LE(8);
  writeFileSync(file, Buffer.concat([head, ...kvs.flatMap(([k, v]) => [str(k), t, str(v)]), Buffer.alloc(pad)]));
}
gguf(join(models, "TinyFam-Q4_K_M.gguf"), [["general.basename", "TinyFam"], ["general.quantized_by", "TestQuant"]]);
gguf(join(models, "BigFam-IQ2_XXS-00001-of-00002.gguf"), [["general.name", "BigFam X"], ["general.quantized_by", "OtherQuant"]], 2_000_000);
gguf(join(models, "BigFam-IQ2_XXS-00002-of-00002.gguf"), [], 1_500_000);
const cfg = (name: string, file: string, port: number) =>
  JSON.stringify({ exe: join(app, "engine", "strata"), args: ["--native", join(models, file)], model_name: name, port });
writeFileSync(join(app, "strata-tiny.json"), cfg("tiny-model", "TinyFam-Q4_K_M.gguf", 18222));

let bigId = linux ? "unit:myllm@big.service" : "cfg:big";
if (linux) {
  // A user's own template service whose script names its config through $HOME.
  const llm = join(home, "llm");
  const units = join(home, ".config", "systemd", "user");
  mkdirSync(llm, { recursive: true });
  mkdirSync(units, { recursive: true });
  writeFileSync(join(llm, "big.json"), cfg("big-model", "BigFam-IQ2_XXS-00001-of-00002.gguf", 18333));
  // An absolute interpreter, as setup's own run scripts use: a user service does not get a login shell's PATH.
  writeFileSync(join(llm, "run-big.sh"), `#!/bin/sh\nexec "${process.execPath}" "$HOME/Strata Apps/strata/serve/server.py" --engine strata --config "$HOME/llm/big.json" --port 18333\n`);
  chmodSync(join(llm, "run-big.sh"), 0o755);
  writeFileSync(join(units, "myllm@.service"), "[Unit]\nDescription=my llm %i\n[Service]\nExecStart=%h/llm/run-%i.sh\n");
  execFileSync("systemctl", ["--user", "daemon-reload"]);
} else {
  writeFileSync(join(app, "strata-big.json"), cfg("big-model", "BigFam-IQ2_XXS-00001-of-00002.gguf", 18333));
}
// Something else listening locally that is not Strata, on a port the analytics try: it must never get the key.
process.env.STRATA_API_KEY = "e2e-secret";
const decoyAuth: string[] = [];
const decoy = createServer((q, r) => {
  if (q.headers.authorization) decoyAuth.push(q.headers.authorization);
  r.end("{}");
}).listen(18444, "127.0.0.1");

// ---------------------------------------------------------------- checks
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = async (id: string) => (await listEngines()).engines.find((e) => e.id === id)?.state;
async function until(id: string, want: string, seconds: number) {
  for (let i = 0; i < seconds * 2; i++) {
    if ((await state(id)) === want) return true;
    await sleep(500);
  }
  return false;
}

configure({ extraFolders: [], useSystemd: true });
configureEndpoints({ knownPorts: async () => [18444] }); // models' own ports: found by scanning, not by config

const { engines, places } = await listEngines(true);
const bare = (id: string) => id.replace(/-[0-9a-f]{8}$/, ""); // cfg ids end in a hash of the config's path
const ids = engines.map((e) => bare(e.id)).sort();
check(`discovers both models (${process.platform})`, JSON.stringify(ids) === JSON.stringify(["cfg:tiny", bigId].sort()), ids);
const tinyId = engines.find((e) => bare(e.id) === "cfg:tiny")?.id ?? "cfg:tiny";
if (!linux) bigId = engines.find((e) => bare(e.id) === "cfg:big")?.id ?? bigId;
const tiny = engines.find((e) => e.id === tinyId);
const big = engines.find((e) => e.id === bigId);
check("GGUF metadata: provider, family, quant", tiny?.provider === "TestQuant" && tiny?.family === "TinyFam" && tiny?.quant === "Q4_K_M", tiny);
check("split GGUF size summed", (big?.sizeBytes ?? 0) > 3_000_000, big?.sizeBytes);
check("launchers", !!tiny?.launcher.startsWith("Strata runtime") && !!big?.launcher.startsWith(linux ? "systemd" : "Strata runtime"), [tiny?.launcher, big?.launcher]);
check("Strata settings place searched", places.some((p) => p.source === "Strata settings" && p.models === (linux ? 1 : 2)), places);
check("autotune result kept: the fake install's server applies saved tuning", engines.every((e) => e.keepsTuning === true), engines.map((e) => e.keepsTuning));
check("picker: smallest model's group first", groupEngines(engines)[0]?.engines[0]?.id === tinyId, groupEngines(engines).map((g) => g.title));

const before = await getSnapshot();
check("no Strata server yet; the unrelated HTTP server is ignored", before.online === false, before);

await loadEngine(tinyId);
check("Strata runtime load reaches ready", await until(tinyId, "ready", 30), await state(tinyId));
const ports = await strataListeners();
check("listener scan finds the server on its non-default port", ports.includes(18222) && !ports.includes(18444), ports);
await sleep(10_500); // the analytics rescan every 10 s
let snap = await getSnapshot();
check("analytics read the running model", snap.online && snap.url === "http://127.0.0.1:18222" && snap.model === "tiny-model", snap);

await loadEngine(bigId);
check("switching stops the other model first", (await state(tinyId)) === "stopped", await state(tinyId));
check("second model reaches ready", await until(bigId, "ready", 30), (await listEngines()).engines.find((e) => e.id === bigId));
await sleep(10_500);
snap = await getSnapshot();
check("analytics follow the switch", snap.online && snap.url === "http://127.0.0.1:18333" && snap.model === "big-model", snap);

await stopEngine(bigId);
check("stop reaches stopped", await until(bigId, "stopped", 30), await state(bigId));
await sleep(1000);
check("no Strata listener left", (await strataListeners()).length === 0, await strataListeners());

await loadEngine(tinyId);
await sleep(300);
await stopEngine(tinyId);
check("abort during a load ends stopped", await until(tinyId, "stopped", 30), await state(tinyId));

// Two clients press Load on different models at once: one model ends up running, the later request.
await Promise.allSettled([loadEngine(tinyId), loadEngine(bigId)]);
await until(bigId, "ready", 30);
const both = (await listEngines()).engines.filter((e) => e.state !== "stopped").map((e) => [bare(e.id), e.state]);
check("concurrent loads: exactly one model runs", both.length === 1 && both[0]![0] === bare(bigId), both);

// Abort pressed while the Load is still stopping the previous model: the new model never starts.
const pending = loadEngine(tinyId);
await stopEngine(tinyId);
await pending.catch(() => {});
await sleep(3000);
check("abort while the load is still preparing: nothing starts", (await until(bigId, "stopped", 30)) && (await state(tinyId)) === "stopped" && (await strataListeners()).length === 0,
  [await state(tinyId), await state(bigId), await strataListeners()]);

// A Strata server this plugin did not start (another profile, a terminal) holds the GPU: Load refuses.
const stranger = spawn(process.execPath, [join(app, "serve", "server.py"), "--config", join(app, "strata-tiny.json"), "--port", "18555"], { stdio: "ignore" });
await sleep(3000);
const refused = await loadEngine(tinyId).then(() => "", (e) => String(e.message));
check("load refuses while a foreign Strata server runs", /did not start/.test(refused) && (await state(tinyId)) === "stopped", refused);
stranger.kill();
check("the decoy on a probed port never received a credential", decoyAuth.length === 0, decoyAuth);

// ---------------------------------------------------------------- tools: update check, benchmark, autotune, update
const waitJob = async (seconds: number) => {
  for (let i = 0; i < seconds * 2; i++) {
    const st = await toolsStatus();
    if (!st.job) return st.history[0] ?? null;
    await sleep(500);
  }
  return null;
};
const u = await checkUpdate(true);
check("update check: offered versions; the found models would not get the new engine", u.available && u.engine.offered === "9.9.9" && !u.reachesModels, u);
await loadEngine(tinyId);
await until(tinyId, "ready", 30);
await startBench(tinyId);
let job = await waitJob(30);
check("benchmark of the running model", job?.kind === "bench" && job.state === "done" && job.details.some((d) => /42\.5 tok\/s/.test(d)), job);
await startTune(tinyId, "quick");
await until(tinyId, "stopped", 60); // after the "before" benchmark; Windows: stopping goes through cmd.exe
const blocked = await loadEngine(bigId).then(() => "", (e) => String(e.message));
check("autotune measures, stops the running model, and blocks Load", (await state(tinyId)) === "stopped" && /Autotune is running/.test(blocked), [await state(tinyId), blocked]);
job = await waitJob(120);
check("autotune result, speed before and after, and the model runs again", job?.state === "done" && /Faster settings/.test(job.outcome ?? "") &&
  job.details.some((d) => /every start/.test(d)) && job.details.some((d) => /^Speed: One request: 42\.5 → 42\.5 tok\/s/.test(d)) &&
  (await state(tinyId)) === "ready", [job, await state(tinyId)]);

// ---------------------------------------------------------------- saved tuning, re-check, server log
let ps = await presetStatus(tinyId);
const saved = ps.presets.find((p) => p.active);
check("saved tuning listed; the new preset is the active one", ps.state === "fresh" && !!saved && saved.gainPct === 8, ps);
ps = await changePreset(tinyId, "off");
check("switch off: no preset active, marked switched off", ps.switchedOff && !ps.presets.some((p) => p.active), ps);
ps = await changePreset(tinyId, "undo");
check("undo: the preset is active again", ps.presets.find((p) => p.active)?.id === saved?.id, ps);
await startRecheck(tinyId, saved!.id);
job = await waitJob(60);
check("re-check stops the model and keeps a preset that is still as fast", job?.kind === "recheck" && job.state === "done" &&
  /still as fast/.test(job.outcome ?? "") && (await until(tinyId, "stopped", 30)), [job, await state(tinyId)]);
const log = await engineLog(tinyId);
check("server log: the model's last start is in it", log.lines.some((l) => /starting/.test(l)), log);

await startUpdate();
job = await waitJob(40);
check("update installs with progress", job?.kind === "update" && job.state === "done" && job.outcome === "Updated" && job.details.length === 2, job);
await startUpdate();
await sleep(1500);
await cancelJob();
job = await waitJob(40);
check("update cancel reports what is installed now", job?.state === "cancelled" && /Installed now: engine/.test(job.outcome ?? ""), job);
const kept = await checkUpdate(true);
check("after an update the previous engine is offered for Undo", kept.previous === "1.0", kept);
await startRollback();
job = await waitJob(40);
check("undo update: back to the previous engine", job?.kind === "rollback" && job.state === "done" && /back to 1\.0/.test(job.outcome ?? "") &&
  (await checkUpdate(true)).previous === null, job);

// ---------------------------------------------------------------- idle stop
await loadEngine(tinyId);
await until(tinyId, "ready", 30);
for (let i = 0; i < 40 && !(await getSnapshot()).online; i++) await sleep(500);
configureIdle(1);
const t1 = Date.now();
const first = await idleTick(t1); // starts counting
const idleStopped = await idleTick(t1 + 2 * 60_000); // two minutes on, the request counter has not moved
configureIdle(0);
check("idle stop: a ready model without requests is stopped after the set minutes and recorded", first === null && idleStopped === tinyId &&
  (await until(tinyId, "stopped", 30)) && (await toolsStatus()).history[0]?.kind === "idle", [first, idleStopped, await state(tinyId)]);
await loadEngine(tinyId);
await until(tinyId, "ready", 30);
await startBench(tinyId);
await sleep(500);
await stopEngine(tinyId); // Stop on the benchmarked model ends the benchmark first
job = await waitJob(20);
check("Stop during a benchmark cancels it, then stops the model", job?.kind === "bench" && job.state === "cancelled" && (await until(tinyId, "stopped", 30)), [job, await state(tinyId)]);

decoy.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures);
