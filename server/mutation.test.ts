import assert from "node:assert/strict";
import { test } from "node:test";
import { exclusive, isBusy } from "./control.ts";
import { startTools, withPresetMutation } from "./tools.ts";

test("preset mutation reserves busy, waits behind an admitted operation and releases after errors", async () => {
  startTools();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  const earlier = exclusive(async () => { entered(); await gate; });
  await started;
  let mutated = false;
  const mutation = withPresetMutation(async () => { mutated = true; });
  assert.equal(isBusy(), true);
  await Promise.resolve();
  assert.equal(mutated, false, "cannot mutate during the earlier operation");
  await assert.rejects(withPresetMutation(async () => {}), /being changed/);
  release(); await earlier; await mutation;
  assert.equal(mutated, true); assert.equal(isBusy(), false);
  await assert.rejects(withPresetMutation(async () => { throw Error("fixture failure"); }), /fixture failure/);
  assert.equal(isBusy(), false, "failed mutation must release reservation");
  let last = false; await exclusive(async () => { last = true; }); assert.equal(last, true);
});
