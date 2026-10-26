import type { PluginServerContext } from "@getpaseo/plugin/server";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESET_JSON_LIMIT, presetImportInput, presetName, strataPresetDetails, strataPresetEffective, strataPresetExport, strataPresetImport, strataPresetRename } from "../shared/preset-admin";
import { presetCli, withPresetMutation } from "./tools";
import { findModel } from "./control";

// Import is deliberately narrower than arbitrary engine configuration: upstream's validator checks bounds,
// but permits unknown flags and environment variables (including process injection and arbitrary paths).
const NUMBER_FLAGS = new Set(["--spec", "--spec-min-p", "--mtp", "--pcie-frac", "--adapt-every", "--adapt-swaps", "--adapt-decay", "--hybrid-rows", "--kv-resident", "--adapt-async", "--pool-workers"]);
const BOOL_FLAGS = new Set(["--kv-grow", "--trim-stage-weights", "--no-host-worker", "--no-pool", "--mmap-experts", "--resident-experts", "--prompt-cache-tail", "--vram-elastic", "--split-skip-if-fits", "--resident-cpu-experts", "--no-hit-poke", "--expert-cache-per-layer", "--batch-mtp"]);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v) || typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v));
const safeArg = (key: string, v: unknown) =>
  NUMBER_FLAGS.has(key) ? v === null || numeric(v) : BOOL_FLAGS.has(key) ? v === null || typeof v === "boolean" :
  key === "--host-core" ? v === null || v === "first" || v === "last" :
  key === "--prefill" && (v === null || numeric(v) || ["auto", "auto:16384", "auto:32768"].includes(String(v)));

// Types follow presets.py staleness/list/notice and autotune.py recheck, not just import_preset's loose checks.
const text = z.string();
const number = z.number().finite();
const count = number.nonnegative();
const optionalText = text.nullish();
const metrics = z.object({
  decode_tok_s: count.nullish(), pp4k_tok_s: count.nullish(), rss_peak_mib: count.nullish(), vram_peak_mib: count.nullish(),
  pairs: count.int().nullish(), faster_pairs: count.int().nullish(), gain_pct: number.nullish(),
  gain_decode_pct: number.nullish(), gain_pp_pct: number.nullish(), noise_aa_decode: number.nullish(),
}).passthrough();
const identity = z.object({
  hardware: z.object({
    hard: z.object({
      gpus: z.array(z.object({ name: text, vram_mib: count.nullish() }).passthrough()).optional(),
      cpu: optionalText, logical: count.int().nullish(), physical: count.int().nullish(), hybrid: z.boolean().nullish(),
      ram_gib: count.nullish(), pcie: optionalText, os: optionalText,
    }).passthrough().optional(),
    soft: z.object({ driver: z.array(text).optional(), os_release: optionalText }).passthrough().optional(),
  }).passthrough().optional(),
  engine: z.object({ version: optionalText, backend: optionalText, build_id: optionalText, sha256: optionalText,
    tuning_epoch: count.int().optional(), path: optionalText }).passthrough().optional(),
  model: z.object({ sha256_shard1: optionalText, bytes: count.nullish(),
    files: z.array(z.object({ name: text, bytes: count.nullish(), digest: optionalText, method: optionalText }).passthrough()).optional(),
  }).passthrough().optional(),
}).passthrough();
const epoch = count.refine((n) => n <= Date.now() / 1000 + 60, "Timestamp cannot be in the future");
const metadata = z.object({
  created_epoch: epoch, created: optionalText,
  choices: z.object({ context: count.int().positive().nullable().optional(), model: optionalText, quant: optionalText,
    model_file: optionalText, kv: optionalText, vision: z.boolean().optional(), goal: z.enum(["room", "speed"]).optional(),
    reserve_mib: count.int().optional(), use: z.enum(["chat", "coding"]).optional(), family: z.enum(["qwen36", "flash-next"]).optional(),
  }).passthrough(), identity,
  answers: z.object({ class: z.enum(["exact", "placement", "nonrepeatable", "quality"]), fields: z.array(text).optional(), default_repeatable: z.boolean().optional() }).passthrough(),
  baseline: metrics.extend({ args: z.record(text, z.unknown()).optional() }).optional(), measured: metrics.optional(),
  recheck: z.object({ request_set: z.literal("recheck/1").optional(), last_ok: optionalText, last_ok_epoch: epoch.nullish(),
    last_result: z.object({ verdict: z.enum(["keep", "retune", "inconclusive"]), request_set: z.literal("recheck/1").optional(),
      measured: metrics.optional(), baseline: metrics.optional(), identity: identity.optional(), seconds: count.optional(),
      reason: optionalText, notes: z.array(text).optional(), problems: z.array(text).optional(),
    }).passthrough().nullish(),
  }).passthrough().optional(),
  tuner: z.object({ mode: text.optional(), version: text.optional(), seconds: count.nullish(), outcome: optionalText }).passthrough().optional(),
  noise: z.object({ aa_gap: number.nullish() }).passthrough().optional(), evidence: z.record(text, z.unknown()).optional(),
}).passthrough();

export function parsePresetImport(json: string): Record<string, any> {
  if (Buffer.byteLength(json, "utf8") > PRESET_JSON_LIMIT) throw new Error("Preset JSON exceeds 512 KiB");
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error("Paste a valid JSON preset"); }
  const visit = (v: unknown, depth: number) => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Preset numbers must be finite");
    if (depth > 24) throw new Error("Preset JSON is nested too deeply");
    if (v && typeof v === "object") for (const [key, value] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Unsafe JSON key");
      visit(value, depth + 1);
    }
  };
  visit(data, 0);
  if (!record(data) || data.schema !== "strata.preset/1" || !record(data.choices) || !record(data.identity) || typeof data.slot !== "string" || !data.slot || !record(data.settings)) throw new Error("Expected a complete Strata preset export (strata.preset/1)");
  data.name = presetName.parse(data.name);
  const checked = metadata.safeParse(data);
  if (!checked.success) throw new Error(`Invalid preset metadata: ${checked.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  // A foreign export is evidence, not proof that a recheck ran on this PC.
  data.recheck = { request_set: "recheck/1", last_ok: null, last_ok_epoch: null, last_result: null };
  for (const section of ["args", "env", "per_request"]) {
    if (!record(data.settings[section])) throw new Error(`settings.${section} must be an object`);
  }
  for (const [key, value] of Object.entries(data.settings.args)) if (!safeArg(key, value)) throw new Error(`Unsupported or unsafe tuning flag: ${key}`);
  for (const [key, value] of Object.entries(data.settings.env)) if (key !== "STRATA_PIN_BY_NEED" || ![null, "0", "1"].includes(value as any)) throw new Error(`Unsupported tuning environment variable: ${key}`);
  for (const [key, value] of Object.entries(data.settings.per_request)) {
    const n = Number(value);
    if (!numeric(value) || !(key === "pcie_frac" && n >= 0 && n <= 0.55 || key === "spec_min_p" && n >= 0.3 && n <= 0.7 || key === "aux_cpus" && [0, 1].includes(n))) throw new Error(`Unsupported or unsafe request setting: ${key}`);
  }
  return data;
}

const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|cookie|credentials|private[_-]?key)$|(?:^|[_-])(?:api[_-]?key|access[_-]?key|token|secret|password|passwd|credential|private[_-]?key)(?:$|[_-])/i;
export function redactPreset(value: unknown): any {
  if (Array.isArray(value)) return value.map((v, i) => {
    if (i > 0 && typeof value[i - 1] === "string" && /^--/.test(value[i - 1]) && SECRET_KEY.test(value[i - 1])) return "[redacted]";
    if (typeof v === "string" && /^--[^=]+=/.test(v) && SECRET_KEY.test(v.split("=", 1)[0])) return `${v.split("=", 1)[0]}=[redacted]`;
    return redactPreset(v);
  });
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, SECRET_KEY.test(key) && !/^(context_tokens|n_tokens|max_tokens|prompt_tokens|completion_tokens|output_tokens|input_tokens)$/.test(key) ? "[redacted]" : redactPreset(v)]));
  if (typeof value === "string") return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/((?:--|\b)(?:api[_-]?key|access[_-]?(?:key|token)|auth[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|cookie|credentials|private[_-]?key)["']?\s*(?:=|:|\s)\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1[redacted]");
  return value;
}
const jsonResult = (v: unknown) => {
  const json = JSON.stringify(redactPreset(v), null, 2);
  if (Buffer.byteLength(json) > PRESET_JSON_LIMIT) throw new Error("Preset details exceed 512 KiB");
  return { json };
};

export type PresetCommand = (id: string, args: string[]) => Promise<Record<string, any>>;
const status = (command: PresetCommand, id: string) => command(id, ["presets", "status", "$target", "--output", "json"]);
async function member(command: PresetCommand, id: string, preset: string) {
  if (!/^[a-f0-9]{32}$/i.test(preset) || !(await status(command, id)).presets?.some((p: any) => p.id === preset)) throw new Error("That preset is not one of this model's");
}

// Mirrors user_args.groups/merge: groups extend to the next --option; no shell or equals parsing.
export function mergeUserArgs(args: string[], user: string[]): string[] {
  const groups = (argv: string[]) => argv.reduce<string[][]>((out, token) => {
    if (token.startsWith("--") || !out.length) out.push([token]);
    else out[out.length - 1]!.push(token);
    return out;
  }, []);
  const overrides = groups(user);
  const mine = new Set(overrides.filter((g) => g[0]!.startsWith("--")).map((g) => g[0]));
  return [...groups(args).filter((g) => !mine.has(g[0])), ...overrides].flat();
}
const supportedArgs = (argv: string[]) => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const equal = token.indexOf("=");
    const key = equal > 0 ? token.slice(0, equal) : token;
    const value = equal > 0 ? token.slice(equal + 1) : BOOL_FLAGS.has(key) ? true : argv[i + 1];
    if (safeArg(key, value)) out[key] = value;
  }
  return out;
};

export function createPresetAdmin(command: PresetCommand, mutate: <T>(fn: () => Promise<T>) => Promise<T>, readConfig: (id: string) => Promise<Record<string, any>> = async () => ({})) {
  const details = async ({ id, preset }: { id: string; preset: string }, exporting = false) => {
    await member(command, id, preset);
    const res = await command(id, ["presets", "show", preset, "--output", "json"]);
    if (!record(res.preset)) throw new Error("The CLI did not return preset details");
    // Upstream export_preset is precisely find() with the transient active field removed.
    const data = { ...res.preset };
    if (exporting) delete data.active;
    return jsonResult(data);
  };
  return {
    details,
    export: (input: { id: string; preset: string }) => details(input, true),
    rename: ({ id, preset, name }: { id: string; preset: string; name: string }) => mutate(async () => {
      name = presetName.parse(name);
      await member(command, id, preset);
      await command(id, ["presets", "rename", preset, "--output", "json", "--", name]);
      return { ok: true as const };
    }),
    import: (input: { id: string; json: string }) => mutate(async () => {
      const { id, json } = presetImportInput.parse(input);
      const data = parsePresetImport(json);
      const before = await status(command, id);
      if (data.slot !== before.slot) throw new Error("This preset belongs to different model choices; import its matching model instead");
      const dir = await mkdtemp(join(tmpdir(), "strata-preset-"));
      try {
        const file = join(dir, "preset.json");
        await writeFile(file, JSON.stringify(data), { mode: 0o600, flag: "wx" });
        const result = await command(id, ["presets", "import", file, "--output", "json"]);
        const after = await status(command, id);
        return { name: String(result.preset?.name ?? data.name), visible: !!after.presets?.some((p: any) => p.id === result.preset?.id) };
      } finally { await rm(dir, { recursive: true, force: true }); }
    }),
    effective: async ({ id }: { id: string }) => {
      const res = await command(id, ["presets", "effective", "$target", "--output", "json"]);
      // Never send the run config's arbitrary arguments/environment, which can contain credentials.
      const cfg = await readConfig(id);
      const user = cfg.user_args ?? [];
      if (!Array.isArray(res.args) || !res.args.every((a: unknown) => typeof a === "string") || !Array.isArray(user) || !user.every((a: unknown) => typeof a === "string")) throw new Error("Cannot determine effective tuning: invalid argument lists");
      const args = supportedArgs(mergeUserArgs(res.args, user));
      const pinned = supportedArgs(user);
      return jsonResult({ applied: res.applied, preset: res.preset, state: res.state, reasons: res.reasons, why_not: res.why_not, notice: res.notice,
        args, env: record(res.env) && ["0", "1"].includes(res.env.STRATA_PIN_BY_NEED) ? { STRATA_PIN_BY_NEED: res.env.STRATA_PIN_BY_NEED } : {},
        per_request: record(res.sampling) && record(res.sampling.strata_tune) ? res.sampling.strata_tune : res.per_request,
        pinned_user_args: pinned,
        changed: Array.isArray(res.changed) ? res.changed.filter((x: any) => record(x) && safeArg(x.flag, x.now) && safeArg(x.flag, x.was)).map((x: any) => ({ ...x, now: args[x.flag] ?? null })).filter((x: any) => x.was !== x.now) : [],
        note: "Saved tuning after pinned user_args overrides, not live process state. Later engine decisions (such as automatic drafting) may change these flags. Only supported tuning arguments and environment are shown." });
    },
  };
}

export function registerPresetAdmin(server: PluginServerContext) {
  const admin = createPresetAdmin(presetCli, withPresetMutation, async (id) => {
    const model = await findModel(id);
    const file = await open(model.config, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
      const st = await file.stat();
      if (!st.isFile() || st.size > 1 << 20) throw new Error("Configuration must be a regular file no larger than 1 MiB");
      const bytes = Buffer.alloc((1 << 20) + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > 1 << 20) throw new Error("Configuration exceeds 1 MiB");
      const cfg: unknown = JSON.parse(bytes.subarray(0, length).toString("utf8").replace(/^\uFEFF/, ""));
      if (!record(cfg)) throw new Error("Configuration must be an object");
      return cfg;
    } finally { await file.close(); }
  });
  server.handle(strataPresetDetails, (input) => admin.details(input));
  server.handle(strataPresetExport, admin.export);
  server.handle(strataPresetRename, admin.rename);
  server.handle(strataPresetImport, admin.import);
  server.handle(strataPresetEffective, admin.effective);
}
