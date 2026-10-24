import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { groupEngines } from "../shared/group.ts";
import { parseShow } from "./control.ts";
import { configFromScript, discover, serverFromScript, splitExec } from "./discover.ts";
import { parseGgufHeader } from "./gguf.ts";
import { parseLsof, parseProcNet, STRATA_SERVER } from "./listeners.ts";
import { fileStem, frontMatter, hfRepo } from "./models.ts";
import type { Os } from "./places.ts";

// ---------------------------------------------------------------- fixtures: a fake machine per test

function gguf(kvs: [string, number, unknown][]): Buffer {
  const parts: Buffer[] = [];
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const str = (s: string) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
  parts.push(Buffer.from("GGUF"), u32(3), u64(0), u64(kvs.length));
  for (const [k, t, v] of kvs) {
    parts.push(str(k), u32(t));
    if (t === 8) parts.push(str(v as string));
    else if (t === 4) parts.push(u32(v as number));
    else if (t === 9) parts.push(u32(8), u64((v as string[]).length), ...(v as string[]).map(str));
  }
  return Buffer.concat(parts);
}

const homes: string[] = [];
after(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

function machine(windows = false) {
  const home = mkdtempSync(join(tmpdir(), "strata-home-"));
  homes.push(home);
  const env: Record<string, string> = {};
  if (windows) Object.assign(env, { APPDATA: join(home, "Roaming"), LOCALAPPDATA: join(home, "Local") });
  const o: Os = { windows, home, env };
  return { home, o };
}

function install(dir: string, models: Record<string, { file: string; meta: [string, number, unknown][]; port?: number }>) {
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "strata"), "#!/bin/sh\n");
  for (const [tag, m] of Object.entries(models)) {
    const w = join(dir, "models", m.file);
    mkdirSync(join(dir, "models"), { recursive: true });
    writeFileSync(w, gguf(m.meta));
    writeFileSync(join(dir, `strata-${tag}.json`), JSON.stringify({ exe: join(dir, "engine/strata"), args: ["--native", w], model_name: `m-${tag}`, port: m.port ?? 8080 }));
  }
  writeFileSync(join(dir, "strata-x.shared-settings.json"), "{}"); // not a run config
}

/** Ids carry a hash of the config's path; the tests compare the readable part. */
const bare = (id: string) => id.replace(/-[0-9a-f]{8}$/, "");

// ---------------------------------------------------------------- tests

test("GGUF header: general keys, also after tokenizer arrays", () => {
  const meta = parseGgufHeader(gguf([
    ["general.name", 8, "Qwen3.8-Flash-Next GSQ-RCO"],
    ["tokenizer.ggml.tokens", 9, ["a", "b", "c"]],
    ["general.quantized_by", 8, "ISTA DASLab"],
    ["general.file_type", 4, 26],
  ]));
  assert.deepEqual(meta, { name: "Qwen3.8-Flash-Next GSQ-RCO", quantized_by: "ISTA DASLab", file_type: 26 });
  assert.throws(() => parseGgufHeader(Buffer.from("nope nope nope nope nope")), /not a GGUF/);
  assert.throws(() => parseGgufHeader(gguf([["general.name", 8, "x"]]).subarray(0, 30)), RangeError);
});

test("Linux: finds installs from Strata's settings file, ignores shared-settings files", async () => {
  const { home, o } = machine();
  const inst = join(home, "Strata");
  install(inst, {
    q2: { file: "Big-Q2_K.gguf", meta: [["general.basename", 8, "Fam"], ["general.quantized_by", 8, "Alpha"]] },
    iq1: { file: "Big-IQ1_M.gguf", meta: [["general.basename", 8, "Fam"], ["general.quantized_by", 8, "Alpha"]], port: 8095 },
  });
  mkdirSync(join(home, ".config/strata"), { recursive: true });
  writeFileSync(join(home, ".config/strata/settings.json"), JSON.stringify({ installs: [inst] }));
  const d = await discover(o);
  assert.deepEqual(d.models.map((m) => [bare(m.id), m.quant, m.provider, m.family, m.launcher.kind]).sort(), [
    ["cfg:iq1", "IQ1_M", "Alpha", "Fam", "strata"],
    ["cfg:q2", "Q2_K", "Alpha", "Fam", "strata"],
  ]);
  assert.equal(d.models.find((m) => bare(m.id) === "cfg:iq1")?.port, 8095);
  assert.ok(d.places.some((p) => p.source === "Strata settings" && p.models === 2));
  assert.ok(d.places.some((p) => p.source === "Strata app" && p.note === "not found"));
});

test("Windows: %APPDATA% settings and the app install under %LOCALAPPDATA%", async () => {
  const { home, o } = machine(true);
  const app = join(home, "Local", "Strata", "install");
  install(app, { iq3_s: { file: "M-IQ3_S.gguf", meta: [["general.quantized_by", 8, "Beta"]] } });
  const d = await discover(o);
  assert.deepEqual(d.models.map((m) => [bare(m.id), m.provider, m.source.startsWith("Strata install")]), [["cfg:iq3_s", "Beta", true]]);
  assert.ok(!d.places.some((p) => p.source === "systemd user services"), "no systemd scan on Windows");
});

test("STRATA_INSTALL_DIR is the only install looked at, like Strata", async () => {
  const { home, o } = machine();
  install(join(home, "a"), { one: { file: "A-Q4_K_M.gguf", meta: [] } });
  install(join(home, "b"), { two: { file: "B-Q4_K_M.gguf", meta: [] } });
  mkdirSync(join(home, ".config/strata"), { recursive: true });
  writeFileSync(join(home, ".config/strata/settings.json"), JSON.stringify({ installs: [join(home, "a")] }));
  o.env.STRATA_INSTALL_DIR = join(home, "b");
  assert.deepEqual((await discover(o)).models.map((m) => bare(m.id)), ["cfg:two"]);
});

test("systemd: template and plain units are adopted; non-Strata units ignored; no duplicates", async () => {
  const { home, o } = machine();
  const inst = join(home, "Strata");
  install(inst, { iq3_s: { file: "Q-IQ3_S.gguf", meta: [["general.quantized_by", 8, "Alpha"]] } });
  writeFileSync(join(inst, "run-iq3_s.sh"), `#!/bin/sh\ncd "${inst}"\nexec "${inst}/.venv/bin/python" "${inst}/serve/server.py" "--engine" "strata" "--config" "${inst}/strata-iq3_s.json" "--port" "8080"\n`);
  const fork = join(home, "fork");
  mkdirSync(join(fork, "model"), { recursive: true });
  writeFileSync(join(fork, "model/quantization_config.json"), JSON.stringify({ bits: 2.05, head_bits: 8 }));
  writeFileSync(join(fork, "model/README.md"), "---\nbase_model: Qwen/Fam\nquantized_by: scorpoon\n---\n# x\n");
  writeFileSync(join(fork, "model/model-00001-of-00001.safetensors"), Buffer.alloc(1000));
  writeFileSync(join(fork, "cfg.json"), JSON.stringify({ exe: join(fork, "strata"), args: ["--exl3", join(fork, "model")], model_name: "exl3", port: 8093 }));
  writeFileSync(join(fork, "start.sh"), `#!/bin/sh\nB=${fork}\nexport X=1\ncd "$B/src"\nexec "$B/py" -m serve.server --config "$B/cfg.json"\n`);
  const units = join(home, ".config/systemd/user");
  mkdirSync(units, { recursive: true });
  mkdirSync(join(home, ".config/strata"), { recursive: true });
  writeFileSync(join(home, ".config/strata/settings.json"), JSON.stringify({ installs: [inst] }));
  writeFileSync(join(units, "strata@.service"), `[Service]\nExecStart=${inst}/run-%i.sh\n`);
  writeFileSync(join(units, "fork.service"), `[Service]\nExecStart=${fork}/start.sh\n`);
  writeFileSync(join(units, "backup@.service"), `[Service]\nExecStart=/usr/bin/python3 /x/run.py --config "/x/config.json" backup %i\n`);
  const d = await discover(o);
  assert.deepEqual(d.models.map((m) => [bare(m.id), m.quant, m.provider, m.family, m.port]).sort(), [
    ["unit:fork.service", "EXL3 2.05 bpw h8", "scorpoon", "Fam", 8093],
    ["unit:strata@iq3_s.service", "IQ3_S", "Alpha", "Q", 8080],
  ]);
  assert.equal(d.models.find((m) => m.id === "unit:fork.service")?.sizeBytes, 1000);
  assert.equal((await discover(o, { systemd: false })).models.map((m) => bare(m.id)).join(), "cfg:iq3_s");
});

test("extra folders: any run config; skipped without an install to run it", async () => {
  const { home, o } = machine();
  const extra = join(home, "extra");
  mkdirSync(extra, { recursive: true });
  writeFileSync(join(extra, "x.gguf"), gguf([]));
  writeFileSync(join(extra, "gyro.json"), JSON.stringify({ exe: "/e/strata", args: ["--native", join(extra, "x.gguf")], model_name: "gyro" }));
  writeFileSync(join(extra, "notes.json"), JSON.stringify({ hello: 1 }));
  let d = await discover(o, { extraFolders: [extra] });
  assert.equal(d.models.length, 0);
  assert.match(d.places.find((p) => p.source === "plugin settings")?.note ?? "", /needs a Strata install/);
  install(join(home, "Strata"), {});
  writeFileSync(join(home, "Strata", "strata-a.json"), JSON.stringify({ exe: "/e", args: [], model_name: "a" }));
  mkdirSync(join(home, ".config/strata"), { recursive: true });
  writeFileSync(join(home, ".config/strata/settings.json"), JSON.stringify({ installs: [join(home, "Strata")] }));
  d = await discover(o, { extraFolders: [extra] });
  assert.deepEqual(d.models.map((m) => bare(m.id)).sort(), ["cfg:a", "cfg:gyro"]);
});

test("split GGUF sizes, HF cache provider, symlinked parts counted once", async () => {
  const { home, o } = machine();
  const snap = join(home, "hub/models--turboderp--Fam-GGUF/snapshots/abc");
  mkdirSync(snap, { recursive: true });
  writeFileSync(join(snap, "Fam-Q2_K-00001-of-00002.gguf"), gguf([]));
  writeFileSync(join(snap, "Fam-Q2_K-00002-of-00002.gguf"), Buffer.alloc(500));
  symlinkSync(join(snap, "Fam-Q2_K-00002-of-00002.gguf"), join(snap, "ple.gguf"));
  const inst = join(home, "S");
  install(inst, {});
  writeFileSync(join(inst, "strata-t.json"), JSON.stringify({ exe: "/e", args: ["--native", join(snap, "Fam-Q2_K-00001-of-00002.gguf"), "--ple-gguf", join(snap, "ple.gguf")] }));
  o.env.STRATA_INSTALL_DIR = inst;
  const [m] = (await discover(o)).models;
  assert.equal(m?.provider, "turboderp");
  assert.equal(m?.family, "Fam");
  assert.equal(m?.sizeBytes, gguf([]).length + 500);
});

test("picker: smallest first, grouped by provider, families kept together", () => {
  const e = (id: string, family: string, provider: string, gb: number | null) =>
    ({ id, family, provider, quant: id, sizeBytes: gb === null ? null : gb * 1e9 }) as any;
  const one = groupEngines([e("a", "Q", "Big", 90), e("b", "Q", "Small", 60), e("c", "Q", "Big", 70), e("d", "Q", "Small", null)]);
  assert.deepEqual(one.map((g) => [g.title, g.engines.map((x) => x.id)]), [["Small", ["b", "d"]], ["Big", ["c", "a"]]]);
  const two = groupEngines([e("a", "Q", "P1", 50), e("b", "G", "P2", 40), e("c", "Q", "P2", 10), e("d", "G", "P1", 45)]);
  assert.deepEqual(two.map((g) => g.title), ["Q · P2", "Q · P1", "G · P2", "G · P1"]);
});

test("parsers: ExecStart, scripts, front matter, HF paths, systemctl", () => {
  assert.deepEqual(splitExec(`-/bin/sh -c 'a b' "c d" e`), ["/bin/sh", "-c", "a b", "c d", "e"]);
  assert.equal(configFromScript(`B=/x\nexec py --config="$B/c.json"`, "/"), "/x/c.json");
  assert.equal(configFromScript(`cd /w\nexec py --config rel.json`, "/"), "/w/rel.json");
  assert.equal(configFromScript(`echo hi`, "/"), null);
  assert.equal(configFromScript(`exec py --config "$HOME/llm/a.json"`, "/", { HOME: "/home/u" }), "/home/u/llm/a.json");
  assert.deepEqual(frontMatter("---\nquantized_by: \"sc\"\nbase_model: Q/F\n---\nbody"), { quantized_by: "sc", base_model: "Q/F" });
  assert.equal(fileStem("/m/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00002.gguf"), "Qwen3.8-Flash-Next-GSQ-RCO");
  assert.deepEqual(hfRepo("/c/hub/models--agentionai--Fam-Gyro-GGUF/snapshots/1/x.gguf"), ["agentionai", "Fam-Gyro-GGUF"]);
  const units = parseShow("Id=a.service\nActiveState=active\nInactiveExitTimestamp=@1761300000\nResult=success\n\nId=b.service\nActiveState=failed\nInactiveExitTimestamp=\nResult=exit-code\n");
  assert.deepEqual(units.get("a.service"), { activeState: "active", result: "success", sinceMs: 1761300000000 });
  assert.equal(units.get("b.service")?.sinceMs, null);
});

test("listeners: /proc/net loopback LISTEN rows, lsof output, server command lines", () => {
  const net = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1",
    "   1: 0500A8C0:1F91 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 222 1",
    "   2: 0100007F:1F92 0100007F:9999 01 00000000:00000000 00:00000000 00000000  1000        0 333 1",
    "   3: 00000000000000000000000001000000:1F9F 00000000000000000000000000000000:0000 0A 0:0 0:0 0 1000 0 444 1",
  ].join("\n");
  assert.deepEqual([...parseProcNet(net)], [["111", 8080], ["444", 8095]]);
  assert.deepEqual([...parseLsof("p12\nn127.0.0.1:8095\nn192.168.1.2:9\np13\nn*:8080\n")], [["12", [8095]], ["13", [8080]]]);
  assert.ok(STRATA_SERVER.test("/v/python /s/serve/server.py --engine strata"));
  assert.ok(STRATA_SERVER.test("C:\\S\\python.exe C:\\S\\serve\\server.py"));
  assert.ok(STRATA_SERVER.test("python -m serve.server --config x"));
  assert.ok(!STRATA_SERVER.test("python3 -m http.server 8080"));
});

test("ids stay with their config when another config of the same name disappears", async () => {
  const { home, o } = machine();
  install(join(home, "a"), { foo: { file: "A-Q4_K_M.gguf", meta: [] } });
  install(join(home, "b"), { foo: { file: "B-Q4_K_M.gguf", meta: [] } });
  mkdirSync(join(home, ".config/strata"), { recursive: true });
  writeFileSync(join(home, ".config/strata/settings.json"), JSON.stringify({ installs: [join(home, "a"), join(home, "b")] }));
  const idOfB = async () => (await discover(o)).models.find((m) => m.config.startsWith(join(home, "b")))?.id;
  const before = await idOfB();
  rmSync(join(home, "a", "strata-foo.json"));
  assert.equal(await idOfB(), before);
  assert.match(before ?? "", /^cfg:foo-[0-9a-f]{8}$/);
});

test("malformed settings and metadata skip that part only", async () => {
  const { home, o } = machine();
  const inst = join(home, "Strata");
  install(inst, {
    good: { file: "G-Q4_K_M.gguf", meta: [["general.quantized_by", 8, "Alpha"]] },
    odd: { file: "O-Q4_K_M.gguf", meta: [["general.basename", 4, 7], ["general.quantized_by", 4, 9]] }, // numbers, not text
  });
  const exl3 = join(inst, "models", "X-exl3");
  mkdirSync(exl3, { recursive: true });
  writeFileSync(join(exl3, "quantization_config.json"), "{not json");
  writeFileSync(join(exl3, "README.md"), "---\nbase_model: org/Fam\n---\n");
  writeFileSync(join(inst, "strata-x.json"), JSON.stringify({ exe: "e", args: ["--exl3", exl3], model_name: "x" }));
  mkdirSync(join(home, ".config/strata"), { recursive: true });
  writeFileSync(join(home, ".config/strata/settings.json"), "{ broken");
  o.env.STRATA_INSTALL_DIR = inst;
  const d = await discover(o);
  assert.deepEqual(d.models.map((m) => [bare(m.id), m.provider]).sort(), [["cfg:good", "Alpha"], ["cfg:odd", "Unknown provider"], ["cfg:x", "Unknown provider"]]);
  assert.equal(d.models.find((m) => bare(m.id) === "cfg:x")?.quant, "EXL3");
  writeFileSync(join(inst, "strata-broken.json"), "{ nope");
  assert.match((await discover(o)).places.find((p) => p.path === inst)?.note ?? "", /^1 JSON file skipped/);
  delete o.env.STRATA_INSTALL_DIR;
  await discover(o); // the broken settings file alone must not throw
});

test("split GGUF with more parts than read: size unknown, not understated", async () => {
  const { home, o } = machine();
  const inst = join(home, "Strata");
  install(inst, {});
  const w = join(inst, "Huge-Q4_K_M-00001-of-00099.gguf");
  writeFileSync(w, gguf([]));
  writeFileSync(join(inst, "strata-huge.json"), JSON.stringify({ exe: "e", args: ["--native", w], model_name: "h" }));
  o.env.STRATA_INSTALL_DIR = inst;
  const [m] = (await discover(o)).models;
  assert.equal(m?.sizeBytes, null);
});

test("parsers: commented-out --config lines, escaped quotes in ExecStart, --host/--port in args", async () => {
  assert.equal(configFromScript("# exec x --config /old.json\nexec x --config /new.json\n", "/d"), "/new.json");
  assert.deepEqual(splitExec(String.raw`/bin/x "a \"b\" c" d`), ["/bin/x", 'a "b" c', "d"]);
  const { cardFor } = await import("./models.ts");
  const card = await cardFor({ exe: "e", args: ["--port", "9001", "--host", "10.0.0.5"], port: 8080 });
  assert.deepEqual([card.port, card.host], [9001, "10.0.0.5"]);
});

test("EXL3 bits from the head of a quantization_config.json far larger than the read limit", async () => {
  const { home, o } = machine();
  const inst = join(home, "Strata");
  install(inst, {});
  const dir = join(inst, "models", "Fam-exl3");
  mkdirSync(dir, { recursive: true });
  const tensors = Object.fromEntries(Array.from({ length: 40_000 }, (_, i) => [`model.layers.${i}.weight`, { bits: 3 }]));
  writeFileSync(join(dir, "quantization_config.json"), JSON.stringify({ quant_method: "exl3", bits: 2.66, head_bits: 6, tensor_storage: tensors }));
  writeFileSync(join(inst, "strata-e.json"), JSON.stringify({ exe: "e", args: ["--exl3", dir], model_name: "e" }));
  o.env.STRATA_INSTALL_DIR = inst;
  const [m] = (await discover(o)).models;
  assert.equal(m?.quant, "EXL3 2.66 bpw h6");
});

test("server file from a start script, and whether that server keeps an autotune result", async () => {
  assert.equal(serverFromScript(`B=/x\ncd "$B/source"\nexec "$B/py" -m serve.server --config c.json`, "/"), "/x/source/serve/server.py");
  assert.equal(serverFromScript(`cd /w\nexec "/s/.venv/bin/python" "/s/serve/server.py" --config c.json`, "/"), "/s/serve/server.py");
  assert.equal(serverFromScript(`# cd /old\nexec python serve/server.py`, "/d"), "/d/serve/server.py");
  assert.equal(serverFromScript(`exec llama-server -m x.gguf`, "/"), null);
  const { home, o } = machine();
  const units = join(home, ".config/systemd/user");
  mkdirSync(units, { recursive: true });
  for (const [name, applies] of [["new", true], ["fork", false]] as const) {
    const dir = join(home, name);
    mkdirSync(join(dir, "serve"), { recursive: true });
    writeFileSync(join(dir, "serve", "server.py"), applies ? "def apply_saved_tuning(cfg: dict) -> dict:\n    ...\n" : "def main(): ...\n");
    writeFileSync(join(dir, "m.gguf"), gguf([]));
    writeFileSync(join(dir, "cfg.json"), JSON.stringify({ exe: join(dir, "engine"), args: ["--native", join(dir, "m.gguf")], model_name: name }));
    writeFileSync(join(dir, "run.sh"), `#!/bin/sh\ncd ${dir}\nexec /py -m serve.server --config ${dir}/cfg.json\n`);
    writeFileSync(join(units, `${name}.service`), `[Service]\nExecStart=${dir}/run.sh\n`);
  }
  const d = await discover(o);
  assert.deepEqual(d.models.map((m) => [m.id, m.keepsTuning]).sort(), [["unit:fork.service", false], ["unit:new.service", true]]);
});
