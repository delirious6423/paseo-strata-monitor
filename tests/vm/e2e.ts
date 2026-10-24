// Runs inside a disposable VM (bundled to plain JS; needs only Node): the plugin's daemon-side code on a
// machine that has never seen the author's setup. It builds a Strata-like layout in the OS's own places
// (Strata settings file, an install elsewhere, GGUF files; on Linux also a user systemd template unit), with
// the fake Strata CLI/server from fake-strata/. Prints PASS/FAIL per check; exit code = number of failures.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configure, listEngines, loadEngine, stopEngine } from "../../server/control";
import { strataListeners } from "../../server/listeners";
import { configureEndpoints, getSnapshot } from "../../server/strata";
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

const bigId = linux ? "unit:myllm@big.service" : "cfg:big";
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
// Something else listening locally that is not Strata.
const decoy = createServer((_q, r) => r.end("{}")).listen(18444, "127.0.0.1");

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
configureEndpoints({ knownPorts: async () => [] }); // analytics must find servers by scanning, not by config

const { engines, places } = await listEngines(true);
const ids = engines.map((e) => e.id).sort();
check(`discovers both models (${process.platform})`, JSON.stringify(ids) === JSON.stringify(["cfg:tiny", bigId].sort()), ids);
const tiny = engines.find((e) => e.id === "cfg:tiny");
const big = engines.find((e) => e.id === bigId);
check("GGUF metadata: provider, family, quant", tiny?.provider === "TestQuant" && tiny?.family === "TinyFam" && tiny?.quant === "Q4_K_M", tiny);
check("split GGUF size summed", (big?.sizeBytes ?? 0) > 3_000_000, big?.sizeBytes);
check("launchers", !!tiny?.launcher.startsWith("Strata runtime") && !!big?.launcher.startsWith(linux ? "systemd" : "Strata runtime"), [tiny?.launcher, big?.launcher]);
check("Strata settings place searched", places.some((p) => p.source === "Strata settings" && p.models === (linux ? 1 : 2)), places);
check("picker: smallest model's group first", groupEngines(engines)[0]?.engines[0]?.id === "cfg:tiny", groupEngines(engines).map((g) => g.title));

const before = await getSnapshot();
check("no Strata server yet; the unrelated HTTP server is ignored", before.online === false, before);

await loadEngine("cfg:tiny");
check("Strata runtime load reaches ready", await until("cfg:tiny", "ready", 30), await state("cfg:tiny"));
const ports = await strataListeners();
check("listener scan finds the server on its non-default port", ports.includes(18222) && !ports.includes(18444), ports);
await sleep(10_500); // the analytics rescan every 10 s
let snap = await getSnapshot();
check("analytics read the running model", snap.online && snap.url === "http://127.0.0.1:18222" && snap.model === "tiny-model", snap);

await loadEngine(bigId);
check("switching stops the other model first", (await state("cfg:tiny")) === "stopped", await state("cfg:tiny"));
check("second model reaches ready", await until(bigId, "ready", 30), (await listEngines()).engines.find((e) => e.id === bigId));
await sleep(10_500);
snap = await getSnapshot();
check("analytics follow the switch", snap.online && snap.url === "http://127.0.0.1:18333" && snap.model === "big-model", snap);

await stopEngine(bigId);
check("stop reaches stopped", await until(bigId, "stopped", 30), await state(bigId));
await sleep(1000);
check("no Strata listener left", (await strataListeners()).length === 0, await strataListeners());

await loadEngine("cfg:tiny");
await sleep(300);
await stopEngine("cfg:tiny");
check("abort during a load ends stopped", await until("cfg:tiny", "stopped", 30), await state("cfg:tiny"));

decoy.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures);
