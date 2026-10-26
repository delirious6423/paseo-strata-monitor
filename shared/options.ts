import { z } from "zod";
import { effectiveUserArgs } from "./model-config";

const text = z.string().max(2000);
const envName = z.string().regex(/^STRATA_[A-Z0-9_]+$/, "Use a STRATA_ credential environment variable");
export const tuneOptionsSchema = z.object({
  use: z.enum(["chat", "coding"]).default("chat"),
  goal: z.enum(["speed", "room", "reserve"]).default("speed"),
  reserveMiB: z.number().int().min(0).max(1048576).default(0),
  leaveRam: z.number().int().min(0).max(50).default(0),
  allowSmallDifferences: z.boolean().default(false),
  allowNotRepeatable: z.boolean().default(false),
  minutes: z.number().positive().max(1440).nullable().default(null),
  name: z.string().trim().max(80).regex(/^[^\r\n\0]*$/, "Preset names cannot contain line breaks or NUL").default(""),
  save: z.boolean().default(true),
  quietCheck: z.boolean().default(true),
  bootTimeout: z.number().min(1).max(86400).default(900),
}).strict();
export type TuneOptions = z.infer<typeof tuneOptionsSchema>;
export const benchOptionsSchema = z.object({
  suite: z.enum(["serving-smoke", "standard-v1", "parallel-mixed-v1", "parallel-overload-v1", "parallel-cancel-v1", "parallel-prefill-cancel-v1"]).default("serving-smoke"),
  concurrency: z.number().int().min(1).max(64).default(4),
  repeat: z.number().int().min(1).max(5).default(1),
  condition: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, "Use a lowercase condition name, up to 40 characters").default("paseo"),
  requestTimeout: z.number().min(1).max(600).default(120),
  credentialEnv: envName.default("STRATA_API_KEY"),
  telemetryCredentialEnv: envName.or(z.literal("")).default(""),
  optionalConcurrency: z.boolean().default(false),
  track: z.enum(["default", "custom"]).default("custom"),
  trackNotes: text.default(""),
  modelRevision: text.default(""), sourceRevision: text.default(""), tokenizerRevision: text.default(""),
  quantization: text.default(""), customPack: text.default(""),
  background: z.array(text).max(32).default([]), buildOptions: text.default(""),
  skipModelHash: z.boolean().default(false),
}).strict().refine((o) => o.suite === "standard-v1" || o.suite === "parallel-overload-v1" || o.concurrency <= 16,
  { message: "Concurrency above 16 is only supported by the overload suite", path: ["concurrency"] });
export type BenchOptions = z.infer<typeof benchOptionsSchema>;

export function validateTuneGoal(config: Record<string, unknown>, o: TuneOptions): void {
  const wanted = o.goal !== "speed" || o.leaveRam > 0 ? "room" : "speed";
  const launchGoal = config.ui_resource_profile === "work" ? "room" : "speed";
  if (o.save && wanted !== launchGoal) throw new Error(`Saved tuning goal ${wanted} does not match this model's launch profile (${launchGoal}). Stop the model and set Model configuration → Resource profile to ${wanted === "room" ? "work" : "full"}, or disable Save for a measurement-only run. This avoids saving a preset that would never be applied.`);
}

// Installed tune_knobs.ARMS mutate these engine flags; runtime user_args would override the candidates.
const tunedFlags = new Set(["--kv-resident", "--prefill", "--adapt-async", "--adapt-every", "--adapt-swaps", "--adapt-decay", "--spec", "--trim-stage-weights", "--pcie-frac", "--pool-workers", "--mtp", "--hybrid-rows", "--host-core", "--kv-grow"]);
export function validateTuneOverrides(config: Record<string, unknown>, presetFlags: string[] = []): void {
  const candidates = new Set([...tunedFlags, ...presetFlags]);
  // Runtime merges raw user_args; capture can drop a raw override removed only from args.
  const raw = Array.isArray(config.user_args) ? config.user_args.filter((v): v is string => typeof v === "string") : [];
  const pinned = [...raw, ...effectiveUserArgs(config)].filter(a => candidates.has(a.split("=")[0]!));
  if (pinned.length) throw new Error(`Autotune cannot test settings pinned by user_args: ${[...new Set(pinned.map(a => a.split("=")[0]))].join(", ")}. Review these overrides in Model configuration → Advanced JSON before tuning. They have not been removed.`);
}

export function tuneArgs(mode: "quick" | "thorough", input: Partial<TuneOptions> = {}): string[] {
  const o = tuneOptionsSchema.parse(input);
  return ["--mode", mode, "--use", o.use, "--goal", o.goal === "reserve" ? `room:${o.reserveMiB}` : o.goal,
    "--leave-ram", String(o.leaveRam), "--boot-timeout", String(o.bootTimeout),
    ...(o.allowSmallDifferences ? ["--allow-small-differences"] : []),
    ...(o.allowNotRepeatable ? ["--allow-not-repeatable"] : []),
    ...(o.minutes !== null ? ["--time", String(o.minutes)] : []), ...(o.name.trim() ? ["--name", o.name.trim()] : []),
    ...(!o.save ? ["--no-save"] : []), ...(!o.quietCheck ? ["--no-quiet-check"] : [])];
}
export function benchArgs(input: Partial<BenchOptions> = {}, repeatOverride?: number): string[] {
  const o = benchOptionsSchema.parse(input);
  const args = ["--suite", o.suite, "--credential-env", o.credentialEnv];
  if (o.suite !== "standard-v1") return [...args, "--concurrency", String(o.concurrency), "--repeat", String(repeatOverride ?? o.repeat),
    "--condition", o.condition, "--request-timeout", String(o.requestTimeout),
    ...(o.telemetryCredentialEnv ? ["--telemetry-credential-env", o.telemetryCredentialEnv] : [])];
  if (o.optionalConcurrency) args.push("--optional-concurrency");
  if (o.skipModelHash) args.push("--skip-model-hash");
  args.push("--track", o.track);
  for (const [flag, value] of [["--track-notes", o.trackNotes], ["--model-revision", o.modelRevision],
    ["--source-revision", o.sourceRevision], ["--tokenizer-revision", o.tokenizerRevision], ["--quantization", o.quantization],
    ["--custom-pack", o.customPack], ["--build-options", o.buildOptions]]) if (value) args.push(flag!, value!);
  for (const value of o.background.map(v => v.trim()).filter(Boolean)) args.push("--background", value);
  return args;
}
