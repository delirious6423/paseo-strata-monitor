import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Snapshot } from "../shared/strata";
import { strataListeners } from "./listeners";
import { DEFAULT_PORTS, type Os, connectionDir, here } from "./places";

// Where the analytics read from: every Strata server this machine can see, found again every 10 s from
// (1) URLs set in the plugin settings, (2) local listeners owned by a Strata server process,
// (3) the ports of discovered models, (4) Strata's saved monitor connections, (5) Strata's default ports.
// A candidate counts only if its /metrics answers with Strata's shape.

const TIMEOUT_MS = 1500;
const CACHE_MS = 400;
const ENDPOINTS_MS = 10_000;

type Endpoint = { url: string; key?: string };

let extraUrls: string[] = [];
let portsOf: () => Promise<number[]> = async () => [];
let os: Os = here();
export function configureEndpoints(next: { extraUrls?: string[]; knownPorts?: () => Promise<number[]> }, o?: Os) {
  if (next.extraUrls) extraUrls = next.extraUrls;
  if (next.knownPorts) portsOf = next.knownPorts;
  if (o) os = o;
  servers = { at: 0, list: [] };
}

const root = (u: string) => u.trim().replace(/\/+$/, "");
const local = (port: number): Endpoint => ({ url: `http://127.0.0.1:${port}` });

/** Strata's saved connections: {url, prefix, credential_env}; the credential stays in that env variable. */
export async function savedConnections(o: Os): Promise<Endpoint[]> {
  const dir = connectionDir(o);
  const out: Endpoint[] = [];
  for (const f of (await readdir(dir).catch(() => [] as string[])).filter((x) => x.endsWith(".json")).slice(0, 64)) {
    try {
      const c = JSON.parse(await readFile(join(dir, f), "utf8"));
      if (typeof c.url !== "string" || !/^https?:\/\//.test(c.url)) continue;
      const key = typeof c.credential_env === "string" ? o.env[c.credential_env] : undefined;
      out.push({ url: root(c.url) + (typeof c.prefix === "string" ? c.prefix : ""), key });
    } catch {}
  }
  return out;
}

export async function candidates(): Promise<Endpoint[]> {
  const list: Endpoint[] = [
    ...extraUrls.filter((u) => /^https?:\/\//.test(u)).map((u) => ({ url: root(u) })),
    ...(await strataListeners().catch(() => [])).map(local),
    ...(await portsOf().catch(() => [])).map(local),
    ...(await savedConnections(os)),
    ...DEFAULT_PORTS.map(local),
  ];
  const seen = new Set<string>();
  return list.filter((e) => !seen.has(e.url) && seen.add(e.url));
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 120) : null);

const offline = (error: string): Snapshot => ({
  online: false, url: null, error, model: null, maxContext: null, state: null, phase: null, queued: null,
  generated: null, maxTokens: null, elapsedS: null, tokS: null, tokSMean: null, prefillTokSMean: null,
  lastDecodeTokS: null, lastPrefillTokS: null,
  gpu: { util: null, tempC: null, powerW: null, memUsed: null, memTotal: null, cpu: null, ramUsed: null, ramTotal: null },
  totals: { requests: null, promptTokens: null, outputTokens: null },
  recent: [],
  servers: [],
});

/** Map Strata's `/metrics` body to the compact snapshot the screen renders. */
export function toSnapshot(url: string, raw: unknown): Snapshot {
  const m = obj(raw), engine = obj(m.engine), live = obj(m.live), hw = obj(m.hardware), totals = obj(m.totals);
  const recent = (Array.isArray(m.requests) ? m.requests : []).slice(0, 10).map((r) => {
    const q = obj(r);
    return {
      time: num(q.time), durationS: num(q.duration_s), finish: str(q.finish),
      promptTokens: num(q.prompt_tokens), outputTokens: num(q.output_tokens), tokS: num(q.decode_tok_s),
    };
  });
  const last = obj(Array.isArray(m.requests) ? m.requests[0] : null);
  const fresh = (num(last.prompt_tokens) ?? 0) - (num(last.reused) ?? 0);
  const promptMs = num(last.prompt_ms);
  return {
    online: true, url, error: null, model: str(engine.model), maxContext: num(engine.max_context),
    state: str(live.state), phase: str(live.phase), queued: num(live.queued), generated: num(live.generated),
    maxTokens: num(live.max_tokens), elapsedS: num(live.elapsed_s), tokS: num(live.tok_s),
    tokSMean: num(live.tok_s_mean), prefillTokSMean: num(live.prefill_tok_s_mean),
    lastDecodeTokS: num(last.decode_tok_s),
    lastPrefillTokS: promptMs && promptMs > 0 && fresh > 0 ? (fresh * 1000) / promptMs : null,
    gpu: {
      util: num(hw.gpu_util), tempC: num(hw.gpu_temp), powerW: num(hw.gpu_power), memUsed: num(hw.gpu_mem_used),
      memTotal: num(hw.gpu_mem_total), cpu: num(hw.cpu), ramUsed: num(hw.ram_used), ramTotal: num(hw.ram_total),
    },
    totals: { requests: num(totals.requests), promptTokens: num(totals.prompt_tokens), outputTokens: num(totals.output_tokens) },
    recent,
    servers: [],
  };
}

/** Strata's /metrics carries an engine or live section; anything else on that port is not Strata. */
export const isStrataMetrics = (raw: unknown) => !!raw && typeof raw === "object" && ("engine" in raw || "live" in raw);

async function fetchMetrics({ url, key }: Endpoint): Promise<Snapshot> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const bearer = key ?? process.env.STRATA_API_KEY;
    const res = await fetch(`${url}/metrics`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      signal: abort.signal,
      redirect: "error",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!isStrataMetrics(raw)) throw new Error("not a Strata server");
    return toSnapshot(url, raw);
  } finally {
    clearTimeout(timer);
  }
}

let lastGood: Endpoint | null = null;
let servers: { at: number; list: Snapshot["servers"] } = { at: 0, list: [] };
let inFlight: Promise<Snapshot> | null = null;
let cached: { at: number; value: Snapshot } | null = null;

async function scan(): Promise<Snapshot> {
  const list = await candidates();
  const ok = (await Promise.allSettled(list.map(fetchMetrics))).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  servers = { at: Date.now(), list: ok.map((s) => ({ url: s.url ?? "", model: s.model })) };
  if (!ok.length) {
    lastGood = null;
    return offline(`no Strata server answered (${list.length} places checked)`);
  }
  // Prefer a server that is working on a request, then the first found.
  const best = ok.find((s) => s.state === "generating") ?? ok[0]!;
  lastGood = list.find((e) => e.url === best.url) ?? null;
  return { ...best, servers: servers.list };
}

async function probe(): Promise<Snapshot> {
  // Steady state: one request to the last working server; a full scan every 10 s or when it stops answering.
  if (lastGood && Date.now() - servers.at < ENDPOINTS_MS) {
    try {
      return { ...(await fetchMetrics(lastGood)), servers: servers.list };
    } catch {}
  }
  return scan();
}

/** Coalesces concurrent callers (several clients/hosts) into one upstream request. */
export function getSnapshot(): Promise<Snapshot> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
  inFlight ??= probe()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
