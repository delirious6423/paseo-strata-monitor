import assert from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../shared/control.ts";
import type { Snapshot } from "../shared/strata.ts";
import { configureIdle, type IdleDeps, idleTick } from "./idle.ts";

const engine = { id: "m", port: 8080, state: "ready" } as Engine;
const snap = (requests: number, state = "idle", queued = 0, url = "http://127.0.0.1:8080") =>
  ({ online: true, url, state, queued, totals: { requests } }) as unknown as Snapshot;

function world(s: () => Snapshot | null) {
  const stopped: string[] = [];
  let busy = false;
  const deps: IdleDeps = {
    engines: async () => [engine],
    snapshot: async () => {
      const v = s();
      if (!v) throw new Error("unreachable");
      return v;
    },
    url: async () => "http://127.0.0.1:8080",
    stop: async (id) => (stopped.push(id), true),
    busy: () => busy,
  };
  return { deps, stopped, setBusy: (b: boolean) => (busy = b) };
}

const MIN = 60_000;

test("idle stop: a ready model with no requests for the set minutes is stopped, once", async () => {
  configureIdle(30);
  let s = snap(5);
  const w = world(() => s);
  assert.equal(await idleTick(0, w.deps), null); // first look: counting starts
  assert.equal(await idleTick(29 * MIN, w.deps), null);
  assert.equal(await idleTick(30 * MIN, w.deps), "m");
  assert.deepEqual(w.stopped, ["m"]);
  configureIdle(0);
});

test("idle stop: a request, a queue, generating, an unreadable or other server all count as active", async () => {
  configureIdle(10);
  let s: Snapshot | null = snap(5);
  const w = world(() => s);
  await idleTick(0, w.deps);
  s = snap(6); // one more request at 9 min: the count starts again
  assert.equal(await idleTick(9 * MIN, w.deps), null);
  s = snap(6);
  assert.equal(await idleTick(18 * MIN, w.deps), null);
  for (const busyNow of [snap(6, "generating"), snap(6, "idle", 1), null, snap(6, "idle", 0, "http://127.0.0.1:9999")]) {
    s = busyNow;
    assert.equal(await idleTick(40 * MIN, w.deps), null, JSON.stringify(busyNow));
  }
  s = snap(6);
  // Readable again at 45 min: its counter is a first reading, so the count starts there, not earlier.
  assert.equal(await idleTick(45 * MIN, w.deps), null);
  assert.equal(await idleTick(54 * MIN, w.deps), null);
  assert.equal(await idleTick(55 * MIN, w.deps), "m");
  configureIdle(0);
});

test("idle stop: off, or a running tool, never stops anything", async () => {
  const w = world(() => snap(1));
  configureIdle(0);
  await idleTick(0, w.deps);
  assert.equal(await idleTick(500 * MIN, w.deps), null);
  configureIdle(5);
  w.setBusy(true);
  await idleTick(0, w.deps);
  assert.equal(await idleTick(500 * MIN, w.deps), null);
  w.setBusy(false);
  assert.equal(await idleTick(501 * MIN, w.deps), null); // after the tool, counting starts again
  assert.equal(await idleTick(507 * MIN, w.deps), "m");
  assert.deepEqual(w.stopped, ["m"]);
  configureIdle(0);
});

test("idle stop: a tool started during the look keeps its model", async () => {
  configureIdle(1);
  const w = world(() => snap(3));
  await idleTick(0, w.deps);
  let looks = 0;
  const deps: IdleDeps = { ...w.deps, busy: () => ++looks > 1 }; // free at the start of the look, busy just before the stop
  assert.equal(await idleTick(2 * MIN, deps), null);
  assert.deepEqual(w.stopped, []);
  configureIdle(0);
});

test("idle stop: another server on the same port, or a missing counter, never stops the local model", async () => {
  configureIdle(1);
  for (const s of [snap(3, "idle", 0, "http://10.0.0.9:8080"), { ...snap(3), totals: { requests: null } } as unknown as Snapshot,
    { ...snap(3), queued: null } as unknown as Snapshot]) {
    const w = world(() => s);
    await idleTick(0, w.deps);
    assert.equal(await idleTick(5 * MIN, w.deps), null, JSON.stringify(s));
    assert.deepEqual(w.stopped, []);
  }
  configureIdle(0);
});

test("idle stop: the setting switched off during a look stops nothing", async () => {
  configureIdle(1);
  const w = world(() => snap(3));
  await idleTick(0, w.deps);
  const deps: IdleDeps = { ...w.deps, snapshot: async () => (configureIdle(0), snap(3)) };
  assert.equal(await idleTick(5 * MIN, deps), null);
  assert.deepEqual(w.stopped, []);
});
