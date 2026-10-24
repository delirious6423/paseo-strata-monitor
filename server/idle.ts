import { findModel, isBusy, listEngines, stopEngine } from "./control";
import { getSnapshot } from "./strata";
import { recordIdleStop } from "./tools";

// Idle stop: a model that is ready and has had no requests for the set minutes is stopped, to free the GPU.
// "No requests" is read from the running server's own counters (Strata's /metrics, as the screen shows it):
// its request total did not change, nothing is queued and its state is "idle". When the server cannot be read,
// or is not the one on the model's port, the model counts as busy: an unknown is never a reason to stop.

const TICK_MS = 30_000;

let minutes = 0;
export const configureIdle = (m: number) => void (minutes = m);

type Seen = { lastActiveMs: number; requests: number | null };
const seen = new Map<string, Seen>();

const real = {
  engines: async () => (await listEngines()).engines,
  snapshot: () => getSnapshot(),
  stop: async (id: string) => {
    const f = await findModel(id);
    await stopEngine(id);
    await recordIdleStop(f, minutes);
  },
  busy: isBusy,
};
export type IdleDeps = typeof real;

/** One look; exported for the tests (`now` and the inputs are injectable). Returns the id it stopped, if any. */
export async function idleTick(now = Date.now(), deps: IdleDeps = real): Promise<string | null> {
  if (minutes <= 0 || deps.busy()) {
    seen.clear(); // a tool or a change of setting starts the count again
    return null;
  }
  const engines = await deps.engines();
  const ready = engines.filter((e) => e.state === "ready");
  for (const id of [...seen.keys()]) if (!ready.some((e) => e.id === id)) seen.delete(id);
  if (!ready.length) return null;
  const snap = await deps.snapshot().catch(() => null);
  for (const e of ready) {
    const s = seen.get(e.id);
    const mine = !!snap?.online && !!snap.url && new URL(snap.url).port === String(e.port);
    const requests = mine ? snap!.totals.requests : null;
    const active = !mine || snap!.state !== "idle" || (snap!.queued ?? 0) > 0 || !s || requests !== s.requests;
    if (active || !s) {
      seen.set(e.id, { lastActiveMs: active ? now : (s?.lastActiveMs ?? now), requests });
      continue;
    }
    if (now - s.lastActiveMs < minutes * 60_000) continue;
    seen.delete(e.id);
    await deps.stop(e.id);
    return e.id;
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
