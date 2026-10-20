import type { Snapshot } from "../shared/strata";

const TIMEOUT_MS = 1500;
const CACHE_MS = 400;
const CANDIDATES = (process.env.STRATA_URL ?? "http://127.0.0.1:8080,http://127.0.0.1:8093")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const KEY = process.env.STRATA_API_KEY;

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
  };
}

async function fetchMetrics(url: string): Promise<Snapshot> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/metrics`, {
      headers: KEY ? { Authorization: `Bearer ${KEY}` } : undefined,
      signal: abort.signal,
      redirect: "error",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return toSnapshot(url, await res.json());
  } finally {
    clearTimeout(timer);
  }
}

let lastGood: string | null = null;
let inFlight: Promise<Snapshot> | null = null;
let cached: { at: number; value: Snapshot } | null = null;

async function probe(): Promise<Snapshot> {
  // Last working URL first, so the steady state is one request per poll.
  const order = lastGood ? [lastGood, ...CANDIDATES.filter((u) => u !== lastGood)] : CANDIDATES;
  let error = "unreachable";
  for (const url of order) {
    try {
      const snap = await fetchMetrics(url);
      lastGood = url;
      return snap;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  lastGood = null;
  return offline(error);
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
