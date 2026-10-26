import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_CONFIG_BYTES = 256 * 1024;
export type ModelConfigDocument = Record<string, unknown>;
const configView = z.object({
  id: z.string(),
  json: z.string().max(MAX_CONFIG_BYTES),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  note: z.string(),
});
export const strataModelConfig = defineRpc({
  name: "strata.model.config",
  input: z.object({ id: z.string().min(1).max(4096) }),
  output: configView,
});
export const strataSaveModelConfig = defineRpc({
  name: "strata.model.config.save",
  input: z.object({ id: z.string().min(1).max(4096), digest: z.string().regex(/^[a-f0-9]{64}$/), json: z.string().max(MAX_CONFIG_BYTES), pruneBackups: z.boolean().default(false) }),
  output: configView.extend({ backup: z.string(), restartRequired: z.literal(true) }),
});

export type ConfigField = {
  key: string; label: string; group: string; help: string;
  kind: "number" | "text" | "boolean" | "choice" | "json";
  flag?: string; choices?: readonly string[]; min?: number; max?: number; integer?: boolean;
};
// Verified against serve/server.py engine_args, serve/runconfig.py EDITABLE, setup.py,
// strata_control/{user_args,tuning}.py in the installed Gyro runtime. Other options stay in full JSON.
export const modelConfigFields: readonly ConfigField[] = [
  { key: "context", flag: "--max-context", label: "Context tokens", group: "Context and memory", kind: "number", min: 1, integer: true, help: "Maximum context allocated by the engine. Larger contexts need more memory." },
  { key: "kv", flag: "--kv", label: "KV cache format", group: "Context and memory", kind: "choice", choices: ["fp16", "int8", "q4_0", "k8v4"], help: "Memory and precision tradeoff. Availability depends on the engine and model family." },
  { key: "expertCache", flag: "--expert-cache", label: "Expert cache slots", group: "Context and memory", kind: "text", help: "auto, or the engine's number of expert slots. This is not a MiB value." },
  { key: "reserve", flag: "--vram-reserve-mib", label: "Free VRAM reserve (MiB)", group: "Context and memory", kind: "number", min: 0, integer: true, help: "VRAM left for the desktop and other programs. The engine default is 700 MiB." },
  { key: "ui_resource_profile", label: "Resource profile", group: "Context and memory", kind: "choice", choices: ["full", "work"], help: "Selects only the saved tuning slot: full uses speed, work uses room. Switching excludes the other slot's preset; it does not reserve memory by itself. Set the VRAM reserve explicitly." },
  { key: "vram_elastic", label: "Elastic expert cache", group: "Context and memory", kind: "boolean", help: "Permit explicit VRAM resizing. Does not resize memory by itself." },
  { key: "vram_segment_mib", label: "Elastic segment (MiB)", group: "Context and memory", kind: "number", min: 1, integer: true, help: "Segment size when elastic memory is enabled. Engine default: 512 MiB. Editing migrates an existing elastic flag to the config so it cannot suppress this size." },
  { key: "drafting", label: "Drafting strategy", group: "Drafting and CPU", kind: "choice", choices: ["auto", "mtp", "dflash2", "off"], help: "DFlash2 can fall back to MTP when unsupported. Off still permits prompt lookup speculation." },
  { key: "mtp", label: "MTP draft layer", group: "Drafting and CPU", kind: "boolean", help: "Legacy draft switch. An explicit Drafting strategy can override it; use that strategy to choose MTP or Off. On uses the installed draft configuration and does not install draft files." },
  { key: "spec", flag: "--spec", label: "Speculative window", group: "Drafting and CPU", kind: "number", min: 0, integer: true, help: "Number of speculative tokens. A wider window is not necessarily faster. Setting this pins it; Autotune and Re-check will refuse until it is set back to Default." },
  { key: "specMinP", flag: "--spec-min-p", label: "Draft confidence floor", group: "Drafting and CPU", kind: "number", min: 0, max: 1, help: "Minimum draft probability. Only applies with a compatible draft layer." },
  { key: "workers", flag: "--pool-workers", label: "CPU pool workers", group: "Drafting and CPU", kind: "number", min: 0, integer: true, help: "Worker count for CPU expert processing. Zero selects automatic sizing. Setting this pins it; Autotune and Re-check will refuse until it is set back to Default." },
  { key: "pool_cores", label: "CPU core affinity", group: "Drafting and CPU", kind: "text", help: "CPU list or range, for example 0,2,4,6 or 2–14:2 (use an ASCII minus in the value)." },
  { key: "gpu", label: "GPU selection (JSON)", group: "GPU and vision", kind: "json", help: "One index (0), an index array ([0,2]), or a quoted comma list (\"0,2\"). Multiple GPUs normally split layers." },
  { key: "layer_split", label: "Layer split", group: "GPU and vision", kind: "text", help: "auto, or the first layer on each later GPU, for example 18 or 16,32. Requires multiple GPUs; a deliberate peer device argument disables layer splitting." },
  { key: "gpu_order", label: "GPU order", group: "GPU and vision", kind: "choice", choices: ["auto", "as_given"], help: "Automatic performance ordering or the configured order. Manual layer splits, peer device arguments and saved GPU roles keep their order even with auto." },
  { key: "split_skip_if_fits", label: "Skip split when one GPU fits", group: "GPU and vision", kind: "boolean", help: "Allow a configured split to use only the first card if it holds all profiled experts and KV." },
  { key: "vision", label: "Vision configuration (JSON)", group: "GPU and vision", kind: "json", help: "Existing reader configuration, including its executable, model, GPU and token limit. Requires installed reader files; saving does not install them. Default removes the section." },
  { key: "parallel", label: "Parallel requests", group: "Serving", kind: "number", min: 1, integer: true, help: "Batch concurrency. The usual limit is 8; larger values require the engine's batch MTP support." },
  { key: "reasoning_budget_tokens", label: "Thinking budget", group: "Serving", kind: "number", min: 0, integer: true, help: "Default thinking cap. Zero means no explicit cap." },
  { key: "fit_max_tokens", label: "Fit answer to remaining context", group: "Serving", kind: "boolean", help: "Shorten max_tokens instead of rejecting a request that does not fit." },
  { key: "anthropic_thinking", label: "Anthropic thinking", group: "Serving", kind: "choice", choices: ["model", "on_request"], help: "Follow model defaults or think only when explicitly requested." },
  { key: "effort_position", label: "Reasoning effort position", group: "Serving", kind: "choice", choices: ["start", "end"], help: "End preserves the prompt cache when effort changes." },
  { key: "sampling", label: "Sampling defaults (JSON)", group: "Serving", kind: "json", help: "All sampling defaults. Temperature ≥ 0; top_p > 0 and ≤ 1; top_k 1–64; min_p 0–1." },
  { key: "aliases", label: "Model aliases (JSON)", group: "Serving", kind: "json", help: "Array of additional model names, or a quoted comma list." },
  { key: "lazy_load", label: "Load on first request", group: "Serving", kind: "boolean", help: "Text only. Cannot be combined with vision." },
  { key: "idle_unload_s", label: "Idle unload (seconds)", group: "Serving", kind: "number", min: 0, help: "Release model memory between requests. Zero disables automatic unload." },
  { key: "engine_silence_s", label: "Engine silence timeout (seconds)", group: "Serving", kind: "number", min: 0, help: "End a request if the engine stays silent this long. Default 300; zero waits forever." },
  { key: "api_monitor", label: "Keep recent prompts in memory", group: "Serving", kind: "boolean", help: "Privacy sensitive: retain up to 100 prompts and answers for the runtime API monitor." },
  { key: "open_browser", label: "Open browser when ready", group: "Serving", kind: "boolean", help: "Permit the runtime chat page when the launcher requests it. On does not open a browser unless the launcher also passes its open option." },
];

const groups = (args: string[]): string[][] => {
  const out: string[][] = [];
  for (const arg of args) {
    if (arg.startsWith("--") || !out.length) out.push([arg]);
    else out[out.length - 1]!.push(arg);
  }
  return out;
};
const argv = (v: unknown): string[] => Array.isArray(v) && v.every(x => typeof x === "string") ? v : [];
const flagOf = (g: string[]) => g[0]!.split("=")[0]!;
const conflicts: Record<string, string[]> = {
  vram_elastic: ["--vram-elastic"], vram_segment_mib: ["--vram-segment-mib"],
  layer_split: ["--layer-split"], split_skip_if_fits: ["--split-skip-if-fits"],
  pool_cores: ["--pool-cores"], parallel: ["--batch", "--slots"], vision: ["--vision"],
};
/** Mirrors upstream user_args.capture: hand edits since args_written override saved user_args. */
export function effectiveUserArgs(config: ModelConfigDocument): string[] {
  const byFlag = (value: unknown) => {
    const map = new Map<string, string[][]>();
    for (const g of groups(argv(value))) {
      const flag = g[0]!.startsWith("--") ? g[0]! : "";
      map.set(flag, [...(map.get(flag) ?? []), g]);
    }
    return map;
  };
  const mine = byFlag(config.user_args);
  if (Array.isArray(config.args_written) && Array.isArray(config.args)) {
    const current = byFlag(config.args), written = byFlag(config.args_written);
    for (const [flag, gs] of current) {
      if (flag && JSON.stringify(written.get(flag)) !== JSON.stringify(gs)) mine.set(flag, gs);
    }
    for (const flag of mine.keys()) if (written.has(flag) && !current.has(flag)) mine.delete(flag);
  }
  return [...mine.values()].flat(2);
}
export function fieldValue(config: ModelConfigDocument, field: ConfigField): unknown {
  const flags = field.flag ? [field.flag] : conflicts[field.key];
  if (!flags || field.key === "vision") return config[field.key];
  const g = [...groups(argv(config.args)), ...groups(argv(config.user_args))].filter(g => flags.includes(flagOf(g))).at(-1);
  if (!g) return field.flag ? undefined : config[field.key];
  const value = g[0]!.includes("=") ? g[0]!.slice(g[0]!.indexOf("=") + 1) : g[1];
  if (field.kind === "boolean") return value === undefined || value === "true";
  return field.flag ? value : field.kind === "number" ? Number(value) : value;
}
export function setFieldValue(config: ModelConfigDocument, field: ConfigField, value: unknown): ModelConfigDocument {
  const next = JSON.parse(JSON.stringify(config)) as ModelConfigDocument;
  if (!field.flag) {
    if (value === undefined) delete next[field.key];
    else next[field.key] = value;
    // An existing --vram-elastic skips the entire top-level segment-generation block upstream.
    if (field.key === "vram_segment_mib" && fieldValue(config, modelConfigFields.find(f => f.key === "vram_elastic")!) === true) {
      next.vram_elastic = true;
    }
    const flags = field.key === "vram_segment_mib" ? [...conflicts.vram_segment_mib!, "--vram-elastic"] : conflicts[field.key];
    if (flags) for (const key of ["args", "user_args"]) {
      if (Array.isArray(next[key])) next[key] = groups(argv(next[key])).filter(g => !flags.includes(flagOf(g))).flat();
    }
    return next;
  }
  // Update both lists: engine_args merges user_args over args at launch. Unknown groups survive intact.
  for (const key of ["args", "user_args"]) {
    const rest = groups(argv(next[key])).filter(g => flagOf(g) !== field.flag);
    if (value !== undefined) rest.push([field.flag, String(value)]);
    next[key] = rest.flat();
  }
  // Keep args_written unchanged: upstream capture must still recognize unrelated hand edits.
  return next;
}
export function parseFieldValue(field: ConfigField, text: string): unknown {
  if (!text.trim()) return undefined;
  if (field.kind === "boolean") {
    if (text !== "true" && text !== "false") throw new Error(`${field.label}: choose On, Off or Default`);
    return text === "true";
  }
  if (field.kind === "number") {
    const n = Number(text);
    if (!Number.isFinite(n) || (field.integer && !Number.isInteger(n)) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
      throw new Error(`${field.label}: enter ${field.integer ? "a whole number" : "a number"}${field.min !== undefined ? ` ≥ ${field.min}` : ""}${field.max !== undefined ? ` and ≤ ${field.max}` : ""}`);
    }
    return n;
  }
  if (field.kind === "json") {
    try { return JSON.parse(text); } catch { throw new Error(`${field.label}: enter valid JSON`); }
  }
  return text;
}
