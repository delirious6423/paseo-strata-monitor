import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import { PRESET_JSON_LIMIT, presetName } from "../shared/preset-admin.ts";
import { createPresetAdmin, mergeUserArgs, parsePresetImport, redactPreset, type PresetCommand } from "./preset-admin.ts";

const pid = "a".repeat(32);
const fixture = () => ({ schema: "strata.preset/1", id: pid, name: "Quick tuning", created_epoch: 1700000000, answers: { class: "exact", fields: [] }, slot: "model-slot", choices: { context: 32768 }, identity: {}, settings: { args: { "--spec": 3 }, env: {}, per_request: { spec_min_p: 0.5 } }, evidence: { arms: [] }, active: true });
const direct = <T>(fn: () => Promise<T>) => fn();

test("import requires bounded, complete upstream JSON and rejects unsafe nesting/keys", () => {
  assert.equal(parsePresetImport(JSON.stringify(fixture())).name, "Quick tuning");
  for (const input of ["invalid", "null", "[]", "{}", JSON.stringify({ ...fixture(), schema: "unknown" }), JSON.stringify({ ...fixture(), settings: { args: [], env: {}, per_request: {} } }), JSON.stringify({ ...fixture(), answers: [] })]) assert.throws(() => parsePresetImport(input));
  assert.throws(() => parsePresetImport(" ".repeat(PRESET_JSON_LIMIT + 1)), /512/);
  assert.throws(() => parsePresetImport(JSON.stringify({ ...fixture(), name: "文".repeat(180000) })), /512/);
  assert.throws(() => parsePresetImport('{"__proto__":{}}'), /Unsafe/);
  assert.throws(() => parsePresetImport("[".repeat(30) + "0" + "]".repeat(30)), /deeply/);
  assert.equal(presetName.safeParse(" \n ").success, false);
  assert.equal(presetName.safeParse("bad\u0000name").success, false);
});

test("metadata rejects poisoned store sorting, staleness, notices and recheck arithmetic", () => {
  const bad = [
    { created_epoch: "today" }, { created_epoch: null }, { created_epoch: [] }, { created_epoch: -1 },
    { created_epoch: Date.now() / 1000 + 3600 }, { created_epoch: undefined },
    { identity: { hardware: [] } }, { identity: { hardware: { hard: "bad" } } },
    { identity: { hardware: { hard: { ram_gib: "64" } } } },
    { identity: { hardware: { hard: { gpus: ["bad"] } } } },
    { identity: { hardware: { soft: { driver: {} } } } },
    { identity: { engine: { tuning_epoch: "bad" } } }, { identity: { model: [] } },
    { identity: { model: { sha256_shard1: {} } } },
    { choices: { context: "32768" } }, { choices: { context: 0 } }, { choices: { use: [] } },
    { choices: { kv: {} } }, { choices: { family: {} } }, { choices: { vision: "false" } },
    { recheck: { last_ok_epoch: "yesterday" } }, { recheck: { last_ok_epoch: {} } },
    { recheck: { last_ok_epoch: Date.now() / 1000 + 3600 } },
    { recheck: { last_result: { verdict: ["keep"] } } },
    { recheck: { last_result: { verdict: "keep", measured: { decode_tok_s: "fast" } } } },
    { recheck: { last_result: { verdict: "keep", identity: { engine: [] } } } },
    { answers: { class: [] } }, { answers: { class: "unknown" } },
    { measured: { gain_pct: "100" } }, { measured: { decode_tok_s: "fast" } },
    { measured: { rss_peak_mib: {} } }, { baseline: { decode_tok_s: [] } },
    { tuner: { seconds: "100" } }, { noise: { aa_gap: {} } }, { name: "x".repeat(81) },
  ];
  for (const patch of bad) assert.throws(() => parsePresetImport(JSON.stringify({ ...fixture(), ...patch })), JSON.stringify(patch));
  assert.throws(() => parsePresetImport(JSON.stringify(fixture()).replace('1700000000', '1e999')), /finite/);
  assert.equal(parsePresetImport(JSON.stringify({ ...fixture(), choices: { context: null } })).choices.context, null);
  assert.equal(presetName.safeParse("x".repeat(80)).success, true);
  assert.equal(presetName.safeParse("x".repeat(81)).success, false);
});

test("foreign recheck claims are validated then cleared, not trusted as local verification", () => {
  const data = parsePresetImport(JSON.stringify({ ...fixture(), recheck: { request_set: "recheck/1", last_ok: "2023-11-14", last_ok_epoch: 1700000000, last_result: { verdict: "keep" } } }));
  assert.deepEqual(data.recheck, { request_set: "recheck/1", last_ok: null, last_ok_epoch: null, last_result: null });
});

test("invalid imported metadata and oversized rename reject before any command", async () => {
  let calls = 0;
  const admin = createPresetAdmin(async () => { calls++; return {}; }, direct);
  for (const patch of [{ created_epoch: "bad" }, { identity: { model: [] } }, { recheck: { last_ok_epoch: {} } }]) {
    await assert.rejects(admin.import({ id: "model", json: JSON.stringify({ ...fixture(), ...patch }) }));
  }
  await assert.rejects(admin.rename({ id: "model", preset: pid, name: "x".repeat(81) }));
  assert.equal(calls, 0);
});

test("export redaction/import roundtrip preserves tokenizer identity and token metrics", () => {
  const original = { ...fixture(), identity: { model: { tokenizer: { path: "tokenizer.json", sha256: "abc" }, tokenizer_sha256: "def" } }, evidence: { arms: [{ output_tokens: 64, tokenization: "bpe" }] } };
  const roundtrip = parsePresetImport(JSON.stringify(redactPreset(original)));
  assert.deepEqual(roundtrip.identity, original.identity);
  assert.deepEqual(roundtrip.evidence, original.evidence);
});

test("import refuses arbitrary paths, executable flags, environment injection and unsafe request values", () => {
  for (const settings of [
    { args: { "--model": "/etc/shadow" } }, { args: { "--mtp": "/tmp/executable" } },
    { args: { "--host-core": "$(command)" } }, { args: { "--spec": {} } },
    { env: { LD_PRELOAD: "/tmp/inject.so" } }, { env: { STRATA_PIN_BY_NEED: "secret" } },
    { per_request: { spec_min_p: 4 } }, { per_request: { filename: "/etc/passwd" } },
  ]) assert.throws(() => parsePresetImport(JSON.stringify({ ...fixture(), settings: { ...fixture().settings, ...settings } })), /Unsupported/);
});

test("credentials are redacted in nested fields, URLs and argv, not numeric token counts", () => {
  const data = redactPreset({ env: { API_KEY: "secret", password: "secret" }, args: ["--api-key", "secret", "--password=secret", "--spec", 3], context_tokens: 32768, note: "Bearer secret https://u:secret@host/" });
  assert.ok(!JSON.stringify(data).includes("secret"));
  assert.equal(data.context_tokens, 32768);
  assert.equal(data.args[4], 3);
});

test("free-form evidence strings redact CLI credentials, assignments and quoted secrets", () => {
  for (const note of ["strata --api-key private-fixture", "strata --api-key=private-fixture", "password: private-fixture", "--auth-token 'private-fixture with spaces'", 'note {"api_key":"private-fixture"}', "https://host/?token=private-fixture&ok=yes"]) {
    const result = JSON.stringify(redactPreset({ evidence: { note } }));
    assert.ok(!result.includes("private-fixture"), result);
  }
});

test("show, export and rename enforce exact preset membership before commands", async () => {
  const calls: string[][] = [];
  const command: PresetCommand = async (_id, args) => { calls.push(args); return args[1] === "status" ? { presets: [{ id: pid }] } : { preset: fixture() }; };
  const admin = createPresetAdmin(command, direct);
  await assert.rejects(admin.rename({ id: "model", preset: "b".repeat(32), name: "New" }), /not one/);
  await assert.rejects(admin.details({ id: "model", preset: "../file" }), /not one/);
  assert.equal(calls.filter((a) => a[1] === "rename" || a[1] === "show").length, 0);
  assert.equal(JSON.parse((await admin.details({ id: "model", preset: pid })).json).active, true);
  assert.equal("active" in JSON.parse((await admin.export({ id: "model", preset: pid })).json), false);
  await admin.rename({ id: "model", preset: pid, name: "--new name" });
  assert.deepEqual(calls.at(-1), ["presets", "rename", pid, "--output", "json", "--", "--new name"]);
});

test("import uses a private temporary file, upstream command, never apply, then removes file", async () => {
  let file = "";
  let imported = false;
  const command: PresetCommand = async (_id, args) => {
    if (args[1] === "status") return { slot: "model-slot", presets: imported ? [{ id: pid }] : [] };
    assert.equal(args[1], "import"); file = args[2];
    // Windows stat mode does not describe its ACL; the directory inherits the user's TEMP ACL.
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, "utf8")).schema, "strata.preset/1");
    imported = true;
    return { preset: { id: pid, name: "Imported" } };
  };
  const result = await createPresetAdmin(command, direct).import({ id: "model", json: JSON.stringify(fixture()) });
  assert.deepEqual(result, { name: "Imported", visible: true });
  await assert.rejects(stat(file), { code: "ENOENT" });
});

test("import rejects wrong slot before writing and preserves command errors with temp cleanup", async () => {
  let file = "";
  const wrong = createPresetAdmin(async () => ({ slot: "other-slot" }), direct);
  await assert.rejects(wrong.import({ id: "model", json: JSON.stringify(fixture()) }), /different model/);
  const admin = createPresetAdmin(async (_id, args) => {
    if (args[1] === "status") return { slot: "model-slot" };
    file = args[2]; throw new Error("upstream: settings outside safe rules");
  }, direct);
  await assert.rejects(admin.import({ id: "model", json: JSON.stringify(fixture()) }), /upstream: settings outside safe rules/);
  await assert.rejects(stat(file), { code: "ENOENT" });
});

test("mutations use the shared lock and do not launch a command if lock rejects", async () => {
  const admin = createPresetAdmin(async () => { throw new Error("should not run"); }, async () => { throw new Error("busy"); });
  await assert.rejects(admin.rename({ id: "model", preset: pid, name: "New" }), /^Error: busy$/);
  await assert.rejects(admin.import({ id: "model", json: "{}" }), /^Error: busy$/);
});

test("user argument merge follows upstream grouping including repeats, negative and multiple values", () => {
  assert.deepEqual(mergeUserArgs(["--spec", "3", "--control-vector-layer-range", "4", "44", "--mtp", "1"], ["--spec", "4", "--control-vector-layer-range", "8", "32", "--pcie-frac", "-0.1", "--spec", "5"]), ["--mtp", "1", "--spec", "4", "--control-vector-layer-range", "8", "32", "--pcie-frac", "-0.1", "--spec", "5"]);
  assert.deepEqual(mergeUserArgs(["--spec", "3"], ["--spec=4"]), ["--spec", "3", "--spec=4"]);
});

test("effective reports final pinned override after saved tune without capturing args_written deltas", async () => {
  const admin = createPresetAdmin(async () => ({ applied: true, args: ["--spec", "3", "--mtp", "1"], changed: [{ flag: "--spec", was: "4", now: "3" }], per_request: { spec_min_p: 0.5 }, sampling: { strata_tune: { spec_min_p: 0.6 } } }), direct,
    async () => ({ args: ["--spec", "8"], args_written: ["--spec", "7"], user_args: ["--spec", "4", "--api-key", "private-fixture"] }));
  const data = JSON.parse((await admin.effective({ id: "model" })).json);
  assert.deepEqual(data.args, { "--mtp": "1", "--spec": "4" });
  assert.deepEqual(data.pinned_user_args, { "--spec": "4" });
  assert.deepEqual(data.changed, []);
  assert.deepEqual(data.per_request, { spec_min_p: 0.6 });
  assert.ok(!JSON.stringify(data).includes("private-fixture"));
  const equal = createPresetAdmin(async () => ({ args: ["--spec", "3"] }), direct, async () => ({ user_args: ["--spec=4"] }));
  assert.equal(JSON.parse((await equal.effective({ id: "model" })).json).args["--spec"], "4");
});

test("effective fails closed when override config is unavailable or malformed", async () => {
  for (const read of [async () => { throw new Error("cannot read"); }, async () => ({ user_args: "--spec 4" })]) {
    const admin = createPresetAdmin(async () => ({ args: ["--spec", "3"] }), direct, read);
    await assert.rejects(admin.effective({ id: "model" }));
  }
});

test("effective settings exclude arbitrary args/env and preserve supported tuning", async () => {
  const admin = createPresetAdmin(async (_id, args) => {
    assert.deepEqual(args, ["presets", "effective", "$target", "--output", "json"]);
    return { applied: true, args: ["--api-key", "secret", "--model", "/private/path", "--spec", "3", "--kv-grow"], env: { API_KEY: "secret", STRATA_PIN_BY_NEED: "1" }, sampling: { secret: "secret" }, changed: [{ flag: "--api-key", was: "oldsecret", now: "secret" }, { flag: "--spec", was: "4", now: "3" }] };
  }, direct);
  const result = (await admin.effective({ id: "model" })).json;
  assert.ok(!result.includes("secret")); assert.ok(!result.includes("/private/path"));
  assert.deepEqual(JSON.parse(result).args, { "--spec": "3", "--kv-grow": true });
  assert.deepEqual(JSON.parse(result).env, { STRATA_PIN_BY_NEED: "1" });
  assert.equal(JSON.parse(result).changed.length, 1);
});
