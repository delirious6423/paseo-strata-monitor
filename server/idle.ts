import { findModel, isBusy, listEngines, serverUrl, stopEngine } from "./control";
import { getSnapshot } from "./strata";
import { recordIdleStop } from "./tools";

// Idle stop: a model that is ready and has had no requests for the set minutes is stopped, to free the GPU.
// "No requests" is read from the running server's own counters (Strata's /metrics, as the screen shows it):
// its request total did not change, nothing is queued and its state is "idle". When the server cannot be read,
// a counter is missing, or the snapshot is of another server (even one on the same port elsewhere), the model
// counts as busy: an unknown is never a reason to stop.

const TICK_MS = 30_000;

let minutes = 0;
export const configureIdle = (m: number) => void (minutes = m);

type Seen = { lastActiveMs: number; requests: number };
const seen = new Map<string, Seen>();

const real = {
  engines: async () => (await listEngines()).engines,
  /** The model's own server root: the snapshot must be of exactly this server (not another one on its port). */
  url: async (id: string) => serverUrl(await findModel(id)),
  snapshot: () => getSnapshot(),
  /** Stop, wait until it is really stopped, then record it. False if it did not stop. */
  stop: async (id: string, limit: number) => {
    const f = await findModel(id);
    await stopEngine(id);
    for (let i = 0; i < 50; i++) {
      await new Promise((ok) => setTimeout(ok, 2000));
      const e = (await listEngines(true)).engines.find((x) => x.id === id);
      if (e?.state === "stopped" || e?.state === "failed") {
        await recordIdleStop(f, limit);
        return true;
      }
    }
    return false;
  },
  busy: isBusy,
};
export type IdleDeps = typeof real;

const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

let ticking = false;

/** One look; exported for the tests (`now` and the inputs are injectable). Returns the id it stopped, if any.
 * Looks never overlap; the setting and the tools are checked again right before stopping. */
export async function idleTick(now = Date.now(), deps: IdleDeps = real): Promise<string | null> {
  if (ticking) return null;
  ticking = true;
  try {
    return await look(now, deps);
  } finally {
    ticking = false;
  }
}

async function look(now: number, deps: IdleDeps): Promise<string | null> {
  const limit = minutes;
  if (limit <= 0 || deps.busy()) {
    seen.clear(); // a tool or a change of setting starts the count again
    return null;
  }
  const ready = (await deps.engines()).filter((e) => e.state === "ready");
  for (const id of [...seen.keys()]) if (!ready.some((e) => e.id === id)) seen.delete(id);
  if (!ready.length) return null;
  const snap = await deps.snapshot().catch(() => null);
  for (const e of ready) {
    const s = seen.get(e.id);
    const own = await deps.url(e.id).catch(() => null);
    const mine = !!snap?.online && !!snap.url && !!own && origin(snap.url) === origin(own);
    // Each sign of idleness must be read, not assumed: a missing counter or queue counts as activity.
    const requests = mine ? snap!.totals.requests : null;
    const quiet = mine && snap!.state === "idle" && snap!.queued === 0 && requests !== null;
    if (!quiet || !s || requests !== s.requests) {
      if (quiet) seen.set(e.id, { lastActiveMs: now, requests: requests! });
      else seen.delete(e.id);
      continue;
    }
    if (now - s.lastActiveMs < limit * 60_000) continue;
    seen.delete(e.id);
    if (minutes !== limit || deps.busy()) return null; // the setting changed, or a tool started, during this look
    return (await deps.stop(e.id, limit)) ? e.id : null;
  }
  return null;
}

let timer: NodeJS.Timeout | null = null;
export function startIdle() {
  timer ??= setInterval(() => void idleTick().catch((e) => console.error("strata: idle stop", e)), TICK_MS);
  timer.unref?.();
}
export function stopIdle() {
  if (timer) clearInterval(timer);
  timer = null;
  seen.clear();
}
