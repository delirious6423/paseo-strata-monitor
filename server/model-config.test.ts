import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Engine } from "../shared/control";
import { MAX_CONFIG_BYTES, effectiveUserArgs, fieldValue, modelConfigFields, parseFieldValue, setFieldValue } from "../shared/model-config";
import { configDigest, createModelConfigService, parseModelConfig, validateModelConfig } from "./model-config";
import type { Found } from "./discover";

const base = () => ({ exe: "/fixture/strata", args: ["--max-context", "32768", "--kv", "int8"], host: "127.0.0.1", port: 8095, extension: { keep: [1, 2, 3] } });
const field = (key: string) => modelConfigFields.find(f => f.key === key)!;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "strata-model-config-"));
  const path = join(dir, "strata-fixture.json");
  writeFileSync(path, JSON.stringify(base()), { mode: 0o600 });
  let state: Engine["state"] = "stopped";
  let busy = false;
  let calls = 0;
  let listingRescan: boolean | undefined;
  let duringListing = () => {};
  const service = createModelConfigService({
    find: async id => {
      if (id !== "fixture-id") throw new Error("Unknown model");
      return { id, config: path } as Found;
    },
    listing: async rescan => { listingRescan = rescan; duringListing(); return { engines: [{ id: "fixture-id", state } as Engine], elsewhere: [], places: [] }; },
    busy: () => busy,
    withLock: async fn => { calls++; return fn(); },
  });
  return { ...service, path, dir, id: "fixture-id", setState: (v: Engine["state"]) => { state = v; }, setBusy: (v: boolean) => { busy = v; }, setDuringListing: (fn: () => void) => { duringListing = fn; }, calls: () => calls, listingRescan: () => listingRescan, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("main fields use actual engine flags, merge overrides and preserve unknown groups", () => {
  const c = { ...base(), args: [...base().args, "--control-vector-layer-range", "4", "44", "--future", "stay"], user_args: ["--max-context", "65536", "--extra", "yes"], args_written: base().args };
  assert.equal(fieldValue(c, field("context")), "65536");
  const next = setFieldValue(c, field("context"), 131072);
  assert.equal(fieldValue(next, field("context")), "131072");
  assert.deepEqual(next.extension, c.extension);
  assert.deepEqual(next.user_args, ["--extra", "yes", "--max-context", "131072"]);
  assert.deepEqual(next.args_written, c.args_written); // Leave upstream manual-change detection intact.
  assert.deepEqual((next.args as string[]).slice(2, 8), ["--control-vector-layer-range", "4", "44", "--future", "stay", "--max-context"]);
  assert.equal(c.args[1], "32768");
  assert.equal(fieldValue(setFieldValue(next, field("context"), undefined), field("context")), undefined);
});

test("guided top-level settings remove conflicting flags but preserve unknown arguments", () => {
  const c = { ...base(), args: ["--vram-elastic", "--vram-segment-mib", "512", "--pool-cores", "0,2", "--batch", "8", "--slots", "8", "--unknown", "keep"], user_args: ["--batch", "6", "--pool-cores=4,6", "--vram-elastic", "--custom", "yes"] };
  let next = setFieldValue(c, field("vram_elastic"), false);
  next = setFieldValue(next, field("pool_cores"), "1,3");
  next = setFieldValue(next, field("parallel"), 2);
  assert.equal(next.vram_elastic, false);
  assert.equal(next.pool_cores, "1,3");
  assert.equal(next.parallel, 2);
  assert.deepEqual(next.args, ["--vram-segment-mib", "512", "--unknown", "keep"]);
  assert.deepEqual(next.user_args, ["--custom", "yes"]);
  assert.deepEqual(c.args.slice(0, 3), ["--vram-elastic", "--vram-segment-mib", "512"]);
  validateModelConfig(next);
  assert.deepEqual(field("ui_resource_profile").choices, ["full", "work"]);
  validateModelConfig(setFieldValue(next, field("ui_resource_profile"), "work"));
});

test("guided values display argv precedence and remove only their own conflicts", () => {
  const c = { ...base(), vram_elastic: false, vram_segment_mib: 128, layer_split: "auto", split_skip_if_fits: false,
    args: ["--vram-elastic", "--vram-segment-mib=512", "--layer-split", "18", "--split-skip-if-fits", "--unknown", "keep"],
    user_args: ["--vram-segment-mib", "1024", "--layer-split=20", "--unknown-user", "stay"] };
  assert.equal(fieldValue(c, field("vram_elastic")), true);
  assert.equal(fieldValue(c, field("vram_segment_mib")), 1024);
  assert.equal(fieldValue(c, field("layer_split")), "20");
  assert.equal(fieldValue(c, field("split_skip_if_fits")), true);
  const segment = setFieldValue(c, field("vram_segment_mib"), 256);
  assert.equal(segment.vram_elastic, true, "preserve the enabled cache when removing the flag that suppresses segment generation");
  assert.equal(segment.vram_segment_mib, 256);
  assert.deepEqual(segment.args, ["--layer-split", "18", "--split-skip-if-fits", "--unknown", "keep"]);
  assert.deepEqual(segment.user_args, ["--layer-split=20", "--unknown-user", "stay"]);
  let next = setFieldValue(segment, field("layer_split"), "16,32");
  next = setFieldValue(next, field("split_skip_if_fits"), false);
  assert.deepEqual(next.args, ["--unknown", "keep"]);
  assert.deepEqual(next.user_args, ["--unknown-user", "stay"]);
  assert.equal(fieldValue(next, field("layer_split")), "16,32");
  assert.equal(fieldValue(next, field("split_skip_if_fits")), false);
  validateModelConfig(next);
  assert.deepEqual(c.args.slice(0, 2), ["--vram-elastic", "--vram-segment-mib=512"]);
});

test("equals syntax and duplicate flags cannot shadow a guided flag edit", () => {
  const c = { ...base(), args: ["--max-context=32768", "--max-context", "4096", "--kv=int8"], user_args: ["--max-context=65536", "--other", "yes"] };
  assert.equal(fieldValue(c, field("context")), "65536");
  const next = setFieldValue(c, field("context"), 8192);
  assert.deepEqual(next.args, ["--kv=int8", "--max-context", "8192"]);
  assert.deepEqual(next.user_args, ["--other", "yes", "--max-context", "8192"]);
  assert.equal(fieldValue(setFieldValue(next, field("context"), undefined), field("context")), undefined);
});

test("removing vision removes its enabling flags without touching reserve or extensions", () => {
  const c = { ...base(), vision: { exe: "reader" }, args: [...base().args, "--vision"], user_args: ["--vision", "--vram-reserve-mib", "700"] };
  const next = setFieldValue(c, field("vision"), undefined);
  assert.equal(next.vision, undefined);
  assert.deepEqual(next.args, base().args);
  assert.deepEqual(next.user_args, ["--vram-reserve-mib", "700"]);
  assert.deepEqual(next.extension, c.extension);
});

test("effective user args mirrors upstream capture, retaining repeated multivalue groups", () => {
  const written = ["--max-context", "32768", "--spec", "4", "--kv", "int8"];
  const config = { args_written: written, args: ["--max-context", "65536", "--kv", "int8", "--control-vector-layer-range", "4", "44", "--control-vector-layer-range", "8", "48"],
    user_args: ["--max-context", "16384", "--spec", "9", "--pool-workers", "2"] };
  assert.deepEqual(effectiveUserArgs(config), ["--max-context", "65536", "--pool-workers", "2", "--control-vector-layer-range", "4", "44", "--control-vector-layer-range", "8", "48"]);
  assert.deepEqual(effectiveUserArgs({ args: ["--kv", "int8"], user_args: ["--spec=7"] }), ["--spec=7"]);
  assert.deepEqual(effectiveUserArgs({ args: written, args_written: written }), []);
  assert.match(field("ui_resource_profile").help, /does not reserve memory/);
});

test("automatic CPU pool sizing survives an unrelated configuration edit", () => {
  const c = { ...base(), args: [...base().args, "--pool-workers", "0"] };
  const next = setFieldValue(c, field("context"), 65536);
  assert.equal(fieldValue(next, field("workers")), "0");
  assert.equal(parseFieldValue(field("workers"), "0"), 0);
  validateModelConfig(next);
});

test("field parsing handles tri-state booleans, numeric bounds and arbitrary JSON", () => {
  assert.equal(parseFieldValue(field("mtp"), "true"), true);
  assert.equal(parseFieldValue(field("mtp"), "false"), false);
  assert.equal(parseFieldValue(field("mtp"), ""), undefined);
  assert.equal(parseFieldValue(field("context"), "131072"), 131072);
  assert.throws(() => parseFieldValue(field("context"), "1.5"));
  assert.throws(() => parseFieldValue(field("specMinP"), "1.01"));
  assert.deepEqual(parseFieldValue(field("gpu"), "[0, 2]"), [0, 2]);
  assert.throws(() => parseFieldValue(field("vision"), "{bad"), /valid JSON/);
});

test("validation accepts the complete document and retains future fields", () => {
  const c = parseModelConfig(JSON.stringify({ ...base(), user_args: ["--new-option", "yes"], vision: { exe: "/fixture/reader", max_tokens: 1024 }, sampling: { temperature: 0.7, top_p: 0.95, top_k: 40, min_p: 0 }, gpu: [0, 2] }));
  validateModelConfig(c);
  assert.deepEqual(c.extension, { keep: [1, 2, 3] });
});

for (const host of ["0.0.0.0", "::", "192.168.0.1", "example.com", "localhost.evil", null]) {
  test(`network invariant rejects host ${String(host)}`, () => assert.throws(() => validateModelConfig({ ...base(), host }), /loopback/));
}
test("network invariant rejects overriding args and user_args", () => {
  for (const key of ["args", "user_args"]) for (const args of [["--host", "0.0.0.0"], ["--host=::"], ["--host"], ["--listen", "0.0.0.0"]]) {
    assert.throws(() => validateModelConfig({ ...base(), [key]: args }), /loopback|listen/);
  }
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) validateModelConfig({ ...base(), host });
});

test("invalid known settings are rejected without echoing JSON contents", () => {
  for (const c of [{ ...base(), mtp: "false" }, { ...base(), vision: null }, { ...base(), vision: {}, lazy_load: true }, { ...base(), sampling: { top_p: 0 } }, { ...base(), sampling: { top_k: 65 } }, { ...base(), port: 70000 }, { ...base(), gpu: [-1] }, { ...base(), user_args: ["--max-context", "NaN"] }]) assert.throws(() => validateModelConfig(c));
  for (const raw of ["[]", "null", "{\"private text\":", JSON.stringify({ args: [] }), JSON.stringify({ exe: "strata", args: [2] }), JSON.stringify({ exe: "strata", args: ["a\0b"] })]) {
    assert.throws(() => parseModelConfig(raw), error => error instanceof Error && !error.message.includes("private text"));
  }
  assert.throws(() => parseModelConfig(" ".repeat(MAX_CONFIG_BYTES + 1)), /256 KiB/);
});

for (const extra of [
  { api_key: "private-fixture" }, { env: { HF_TOKEN: "private-fixture" } },
  { env: { AWS_ACCESS_KEY_ID: "private-fixture" } }, { mcp_servers: [{ env: { CLIENT_SECRET: "private-fixture" } }] },
  { args: ["--api-key", "private-fixture"] }, { args: ["--api-key=private-fixture"] },
  { args: ["--token=private-fixture"] }, { user_args: ["--token=private-fixture"] },
  { endpoint: "https://user:private-fixture@example.com" }, { headers: { Authorization: "Bearer private-fixture" } },
  { endpoint: "postgres://user:private-fixture@example.com/db" }, { endpoint: "https://example.com/?api_key=private-fixture" },
]) test(`credentials fail closed: ${Object.keys(extra)[0]} ${JSON.stringify(extra).length}`, () => {
  assert.throws(() => parseModelConfig(JSON.stringify({ ...base(), ...extra })), error => error instanceof Error && /credential/.test(error.message) && !error.message.includes("private-fixture"));
});

test("read resolves model IDs and refuses arbitrary paths", async () => {
  const f = fixture();
  try {
    const got = await f.read({ id: f.id });
    assert.equal(got.digest, configDigest(readFileSync(f.path, "utf8")));
    await assert.rejects(f.read({ id: f.path }), /Unknown model/);
    assert.equal(f.calls(), 0);
  } finally { f.cleanup(); }
});

test("save backs up exact bytes, atomically replaces config, preserves unknowns and never launches", async () => {
  const f = fixture();
  try {
    const before = readFileSync(f.path, "utf8");
    const got = await f.read({ id: f.id });
    const c = setFieldValue(parseModelConfig(got.json), field("context"), 131072);
    const saved = await f.save({ id: f.id, digest: got.digest, json: JSON.stringify(c) });
    assert.equal(readFileSync(join(f.dir, saved.backup), "utf8"), before);
    assert.equal(readFileSync(f.path, "utf8"), saved.json);
    assert.equal(saved.digest, configDigest(saved.json));
    assert.equal(saved.restartRequired, true);
    assert.deepEqual(JSON.parse(saved.json).extension, base().extension);
    assert.equal(f.calls(), 1);
    assert.equal(f.listingRescan(), true, "save requires fresh discovery and foreign-server evidence under the lock");
    assert.equal(readdirSync(f.dir).filter(p => p.endsWith(".tmp")).length, 0);
    assert.match(saved.note, /never restarts/);
    const again = await f.save({ id: f.id, digest: saved.digest, json: saved.json });
    assert.notEqual(again.backup, saved.backup);
    assert.equal(readFileSync(join(f.dir, saved.backup), "utf8"), before);
  } finally { f.cleanup(); }
});

test("retention keeps newest 10 plugin backups and archives older bytes without touching other files", async () => {
  const f = fixture();
  try {
    const uuid = "00000000-0000-4000-8000-000000000000";
    const untouched = [`strata-fixture.json.bak-${uuid}`, `strata-other.json.bak-paseo-${uuid}`, `strata-fixture.json.bak-paseo-${uuid}.user`, "user-backup.txt"];
    for (const name of untouched) writeFileSync(join(f.dir, name), "user data");
    const link = `strata-fixture.json.bak-paseo-${uuid}`;
    symlinkSync(join(f.dir, "user-backup.txt"), join(f.dir, link));
    const directory = "strata-fixture.json.bak-paseo-11111111-1111-4111-8111-111111111111";
    mkdirSync(join(f.dir, directory));
    let view = await f.read({ id: f.id });
    const backups: { name: string; raw: string }[] = [];
    for (let i = 0; i < 15; i++) {
      const raw = readFileSync(f.path, "utf8");
      const saved = await f.save({ id: f.id, digest: view.digest, json: JSON.stringify({ ...base(), generation: i }) });
      backups.push({ name: saved.backup, raw });
      const time = new Date(1000000 + i * 1000);
      utimesSync(join(f.dir, saved.backup), time, time);
      view = saved;
    }
    const archive = `${f.path}.paseo-backup-archive`;
    assert.equal(readdirSync(archive).length, 5);
    assert.deepEqual(readdirSync(f.dir).filter(name => name.startsWith("strata-fixture.json.bak-paseo-") && ![link, directory].includes(name) && !name.endsWith(".user")).sort(), backups.slice(5).map(b => b.name).sort());
    for (let i = 0; i < backups.length; i++) assert.equal(readFileSync(join(i < 5 ? archive : f.dir, backups[i]!.name), "utf8"), backups[i]!.raw);
    for (const name of untouched) assert.equal(readFileSync(join(f.dir, name), "utf8"), "user data");
    assert.ok(lstatSync(join(f.dir, link)).isSymbolicLink());
    assert.ok(lstatSync(join(f.dir, directory)).isDirectory());
    assert.match(view.note, /never deleted/);
  } finally { f.cleanup(); }
});

test("explicit pruning retains newest 10 across both locations and only deletes exact plugin backup files", async () => {
  const f = fixture();
  try {
    let view = await f.read({ id: f.id });
    const backups: { name: string; raw: string }[] = [];
    for (let i = 0; i < 15; i++) {
      const raw = readFileSync(f.path, "utf8");
      const saved = await f.save({ id: f.id, digest: view.digest, json: JSON.stringify({ ...base(), generation: i }), pruneBackups: false });
      backups.push({ name: saved.backup, raw });
      const time = new Date(1000000 + i * 1000); utimesSync(join(f.dir, saved.backup), time, time);
      view = saved;
    }
    const archive = `${f.path}.paseo-backup-archive`;
    // A recently modified archive must survive ahead of older adjacent backups.
    const future = new Date(Date.now() + 100000); utimesSync(join(archive, backups[0]!.name), future, future);
    const uuid = "00000000-0000-4000-8000-000000000000";
    const untouched = [`strata-fixture.json.bak-${uuid}`, `strata-other.json.bak-paseo-${uuid}`, `strata-fixture.json.bak-paseo-${uuid}.user`, "user-backup.txt"];
    for (const dir of [f.dir, archive]) {
      for (const name of untouched) writeFileSync(join(dir, name), "user data");
      symlinkSync(join(dir, "user-backup.txt"), join(dir, `strata-fixture.json.bak-paseo-${uuid}`));
      mkdirSync(join(dir, "strata-fixture.json.bak-paseo-11111111-1111-4111-8111-111111111111"));
    }
    const before = readFileSync(f.path, "utf8");
    const saved = await f.save({ id: f.id, digest: view.digest, json: view.json, pruneBackups: true });
    assert.equal(readFileSync(join(f.dir, saved.backup), "utf8"), before, "new backup is always retained");
    assert.equal(readFileSync(join(archive, backups[0]!.name), "utf8"), backups[0]!.raw);
    for (const backup of backups.slice(1, 7)) {
      assert.ok(!readdirSync(f.dir).includes(backup.name));
      assert.ok(!readdirSync(archive).includes(backup.name));
    }
    for (const backup of backups.slice(7)) assert.equal(readFileSync(join(f.dir, backup.name), "utf8"), backup.raw);
    for (const dir of [f.dir, archive]) {
      for (const name of untouched) assert.equal(readFileSync(join(dir, name), "utf8"), "user data");
      assert.ok(lstatSync(join(dir, `strata-fixture.json.bak-paseo-${uuid}`)).isSymbolicLink());
      assert.ok(lstatSync(join(dir, "strata-fixture.json.bak-paseo-11111111-1111-4111-8111-111111111111")).isDirectory());
    }
    assert.match(saved.note, /deletion was enabled/);
    assert.equal(saved.json, readFileSync(f.path, "utf8"));
  } finally { f.cleanup(); }
});

test("backup deletion requires a boolean opt-in, never truthy strings", async () => {
  const f = fixture();
  try {
    const view = await f.read({ id: f.id });
    await assert.rejects(f.save({ id: f.id, digest: view.digest, json: view.json, pruneBackups: "true" as unknown as boolean }), /boolean opt-in/);
    assert.deepEqual(readdirSync(f.dir), ["strata-fixture.json"]);
  } finally { f.cleanup(); }
});

test("archive collisions never overwrite user data or remove the original backup", async () => {
  const f = fixture();
  try {
    let view = await f.read({ id: f.id });
    let oldest = "", original = "";
    for (let i = 0; i < 10; i++) {
      const before = readFileSync(f.path, "utf8");
      const saved = await f.save({ id: f.id, digest: view.digest, json: JSON.stringify({ ...base(), generation: i }) });
      if (!i) { oldest = saved.backup; original = before; }
      const time = new Date(1000000 + i * 1000); utimesSync(join(f.dir, saved.backup), time, time);
      view = saved;
    }
    const archive = `${f.path}.paseo-backup-archive`; mkdirSync(archive);
    writeFileSync(join(archive, oldest), "user data");
    const saved = await f.save({ id: f.id, digest: view.digest, json: JSON.stringify({ ...base(), generation: 10 }) });
    assert.equal(readFileSync(join(archive, oldest), "utf8"), "user data");
    assert.equal(readFileSync(join(f.dir, oldest), "utf8"), original);
    assert.match(saved.note, /archiving could not finish/);
    assert.equal(JSON.parse(readFileSync(f.path, "utf8")).generation, 10);
  } finally { f.cleanup(); }
});

for (const prune of [false, true]) test(`unsafe archive symlink cannot move or delete backups outside config or undo a save (prune=${prune})`, async () => {
  const f = fixture();
  try {
    const outside = join(f.dir, "not-an-archive"); mkdirSync(outside);
    symlinkSync(outside, `${f.path}.paseo-backup-archive`, "dir");
    const outsideBackup = join(outside, "strata-fixture.json.bak-paseo-00000000-0000-4000-8000-000000000000");
    writeFileSync(outsideBackup, "user data");
    let view = await f.read({ id: f.id });
    for (let i = 0; i < 11; i++) view = await f.save({ id: f.id, digest: view.digest, json: JSON.stringify({ ...base(), generation: i }), pruneBackups: prune });
    assert.equal(readdirSync(outside).length, 1);
    assert.equal(readFileSync(outsideBackup, "utf8"), "user data");
    assert.equal(readdirSync(f.dir).filter(name => name.startsWith("strata-fixture.json.bak-paseo-")).length, 11);
    assert.equal(JSON.parse(readFileSync(f.path, "utf8")).generation, 10);
    assert.match(view.note, prune ? /pruning could not finish.*save succeeded/ : /archiving could not finish/);
  } finally { f.cleanup(); }
});

test("stale revision refuses write and preserves the external update", async () => {
  const f = fixture();
  try {
    const got = await f.read({ id: f.id });
    const changed = JSON.stringify({ ...base(), changedExternally: true });
    writeFileSync(f.path, changed);
    await assert.rejects(f.save({ id: f.id, json: got.json, digest: got.digest }), /changed on disk/);
    assert.equal(readFileSync(f.path, "utf8"), changed);
    assert.deepEqual(readdirSync(f.dir), ["strata-fixture.json"]);
  } finally { f.cleanup(); }
});

for (const state of ["loading", "ready", "stopping", "unknown"] as const) test(`refuses save while model is ${state}`, async () => {
  const f = fixture();
  try {
    const got = await f.read({ id: f.id }); f.setState(state);
    await assert.rejects(f.save({ id: f.id, json: got.json, digest: got.digest }), /Stop all models/);
    assert.deepEqual(readdirSync(f.dir), ["strata-fixture.json"]);
  } finally { f.cleanup(); }
});

test("tool activity checked both before listing and immediately before file write", async () => {
  const f = fixture();
  try {
    const got = await f.read({ id: f.id });
    f.setBusy(true);
    await assert.rejects(f.save({ id: f.id, json: got.json, digest: got.digest }), /tool is running/);
    f.setBusy(false); f.setDuringListing(() => f.setBusy(true));
    await assert.rejects(f.save({ id: f.id, json: got.json, digest: got.digest }), /tool started/);
    assert.deepEqual(readdirSync(f.dir), ["strata-fixture.json"]);
  } finally { f.cleanup(); }
});

test("credential file, oversized file and symlink never reach editor", async () => {
  const f = fixture();
  try {
    writeFileSync(f.path, JSON.stringify({ ...base(), env: { OPENAI_API_KEY: "private-fixture" } }));
    await assert.rejects(f.read({ id: f.id }), /credentials/);
    writeFileSync(f.path, " ".repeat(MAX_CONFIG_BYTES + 1));
    await assert.rejects(f.read({ id: f.id }), /256 KiB/);
    writeFileSync(f.path, Buffer.from([0xff]));
    await assert.rejects(f.read({ id: f.id }), /UTF8/);
    rmSync(f.path);
    const target = join(f.dir, "target.json"); writeFileSync(target, JSON.stringify(base())); symlinkSync(target, f.path);
    await assert.rejects(f.read({ id: f.id }), /symlink/);
  } finally { f.cleanup(); }
});

test("raw duplicate JSON keys cannot leak discarded secret values", async () => {
  const f = fixture();
  try {
    writeFileSync(f.path, '{"exe":"strata","args":[],"api_key":"private-fixture","api_key":null}');
    const got = await f.read({ id: f.id });
    assert.ok(!got.json.includes("private-fixture"));
    assert.equal(JSON.parse(got.json).api_key, null);
  } finally { f.cleanup(); }
});
