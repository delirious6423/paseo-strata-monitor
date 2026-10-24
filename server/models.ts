import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readGgufMeta } from "./gguf";

// What a Strata run config serves: its weight files, their size, and who made which quant of what.
// Facts come from the files themselves (GGUF header, EXL3 quantization_config.json and model card),
// then from where they sit (Hugging Face cache folder names), then from file names.

export type RunConfig = { exe: string; args: string[]; model_name?: string; port?: number; host?: string };

export type ModelCard = {
  name: string;
  port: number;
  host: string | null;
  format: "gguf" | "exl3" | "other";
  quant: string;
  family: string;
  provider: string;
  sizeBytes: number | null;
  weights: string[];
};

export async function readRunConfig(path: string): Promise<RunConfig | null> {
  try {
    const st = await stat(path);
    if (!st.isFile() || st.size > 1 << 20) return null;
    const c = JSON.parse(await readFile(path, "utf8"));
    if (!c || typeof c.exe !== "string" || !Array.isArray(c.args) || !c.args.every((a: unknown) => typeof a === "string")) return null;
    return c;
  } catch {
    return null;
  }
}

const flag = (args: string[], f: string) => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const MAX_PARTS = 64;

/** A small JSON object from disk, or {} when missing, too big, malformed or not an object. */
export async function smallJson(path: string): Promise<Record<string, any>> {
  try {
    if ((await stat(path)).size > 1 << 20) return {};
    const v = JSON.parse(await readFile(path, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** `X-00001-of-00003.gguf` and its siblings; null past MAX_PARTS (size unknown rather than understated). */
function withSplits(file: string): string[] | null {
  const m = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i.exec(basename(file));
  if (!m) return [file];
  const n = Number(m[3]);
  if (n > MAX_PARTS) return null;
  return Array.from({ length: n }, (_, i) => join(dirname(file), `${m[1]}-${String(i + 1).padStart(5, "0")}-of-${m[3]}.gguf`));
}

type Weights = { format: ModelCard["format"]; files: string[]; dir: string | null; partial?: boolean };
async function weightFiles(args: string[]): Promise<Weights> {
  const exl3 = flag(args, "--exl3");
  if (exl3) {
    const files = (await readdir(exl3).catch(() => [] as string[])).filter((f) => f.endsWith(".safetensors")).map((f) => join(exl3, f));
    return { format: "exl3", files, dir: exl3 };
  }
  const native = flag(args, "--native") ?? flag(args, "--model") ?? flag(args, "-m");
  if (native && native.toLowerCase().endsWith(".gguf")) {
    const ple = flag(args, "--ple-gguf");
    const parts = [withSplits(native), ...(ple ? [withSplits(ple)] : [])];
    const files = new Set(parts.flatMap((p, i) => p ?? [i ? ple! : native]));
    return { format: "gguf", files: [...files], dir: null, partial: parts.some((p) => !p) };
  }
  return { format: "other", files: [], dir: null };
}

async function totalSize(files: string[]): Promise<number | null> {
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    try {
      const real = await realpath(f);
      if (seen.has(real)) continue;
      seen.add(real);
      total += (await stat(real)).size;
    } catch {
      return null; // a part is missing: unknown, not smaller
    }
  }
  return files.length ? total : null;
}

/** `.../models--turboderp--Qwen3.8-Flash-Next-exl3/snapshots/<sha>/...` -> ["turboderp", "Qwen3.8-Flash-Next-exl3"] */
export function hfRepo(path: string): [string, string] | null {
  const m = /models--([^/\\]+?)--([^/\\]+)[/\\]snapshots[/\\]/.exec(path);
  return m ? [m[1]!, m[2]!] : null;
}

const repoOrg = (url: unknown) => (typeof url === "string" ? /huggingface\.co\/([^/]+)/.exec(url)?.[1] ?? null : null);

/** YAML front matter `key: value` scalars of a model card. */
export function frontMatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of m?.[1]?.split(/\r?\n/) ?? []) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.+?)\s*$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

const QUANT = /(UD-)?(IQ\d_[A-Z0-9]+(?:_[A-Z])?|TQ\d_\d|Q\d_K(?:_[A-Z]+)?|Q\d_\d|MXFP4|BF16|F16|F32)/i;

/** Strip a quant/provider tail from a repo or folder name: "Qwen3.8-Flash-Next-GSQ-RCO-GGUF" -> "Qwen3.8-Flash-Next-GSQ-RCO". */
const stripTail = (s: string) => s.replace(/[-_.](gguf|exl3|exl2|awq|gptq)$/i, "").replace(/[-_]\d+(\.\d+)?bpw.*$/i, "");

/** "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00002.gguf" -> "Qwen3.8-Flash-Next-GSQ-RCO" */
export const fileStem = (file: string) => {
  const name = basename(file).replace(/\.gguf$/i, "").replace(/-\d{5}-of-\d{5}$/, "");
  const q = QUANT.exec(name);
  return (q ? name.slice(0, q.index) : name).replace(/[-_.]+$/, "") || null;
};

function familyOf(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) if (c && c.trim()) return c.trim();
  return "Unknown family";
}

type Meta = { quant: string; family: string; provider: string };
const metaCache = new Map<string, { key: string; meta: Meta }>();

async function describe(format: ModelCard["format"], files: string[], dir: string | null, fallbackName: string): Promise<Meta> {
  const first = dir ?? files[0] ?? "";
  const st = await stat(first).catch(() => null);
  const key = `${first}|${st?.size}|${st?.mtimeMs}`;
  const hit = metaCache.get(first);
  if (hit && hit.key === key) return hit.meta;
  const hf = hfRepo(first);
  let meta: Meta;
  if (format === "gguf") {
    const g = (await readGgufMeta(files[0]!)) ?? {};
    const text = (v: unknown) => (typeof v === "string" ? v : undefined); // header values are untrusted
    const name = text(g.name) ?? null;
    meta = {
      quant: QUANT.exec(basename(files[0]!))?.[0]?.toUpperCase() ?? "GGUF",
      family: familyOf(text(g.basename), name?.split(" ")[0], hf && stripTail(hf[1]), fileStem(files[0]!), text(g.architecture)),
      provider: text(g.quantized_by) || hf?.[0] || repoOrg(text(g.repo_url)) || text(g.organization) || "Unknown provider",
    };
  } else if (format === "exl3" && dir) {
    const q = (await smallJson(join(dir, "quantization_config.json"))) as Record<string, unknown>;
    const readme = join(dir, "README.md");
    const card = frontMatter(((await stat(readme).catch(() => null))?.size ?? Infinity) < 1 << 20 ? await readFile(readme, "utf8").catch(() => "") : "");
    const bits = typeof q.bits === "number" ? `${q.bits} bpw` : "EXL3";
    meta = {
      quant: `EXL3 ${bits}${typeof q.head_bits === "number" ? ` h${q.head_bits}` : ""}`,
      family: familyOf(card.base_model?.split("/").pop(), hf && stripTail(hf[1]), stripTail(basename(dir))),
      provider: card.quantized_by || hf?.[0] || "Unknown provider",
    };
  } else {
    meta = { quant: "?", family: familyOf(fallbackName), provider: "Unknown provider" };
  }
  metaCache.set(first, { key, meta });
  return meta;
}

export async function cardFor(config: RunConfig): Promise<ModelCard> {
  const { format, files, dir, partial } = await weightFiles(config.args);
  const name = typeof config.model_name === "string" ? config.model_name : basename(config.exe);
  const [sizeBytes, meta] = await Promise.all([partial ? null : totalSize(files), describe(format, files, dir, name)]);
  const port = Number(flag(config.args, "--port") ?? config.port);
  const host = flag(config.args, "--host") ?? (typeof config.host === "string" ? config.host : null);
  return { name, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8095, host, format, sizeBytes, weights: files, ...meta };
}
