import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "strata-root-"));
for (const f of ["run-iq3_s.sh", "run-iq3_xxs.sh", "run-bad name.sh", "run-x;rm.sh", "notes.txt"]) writeFileSync(join(root, f), "");
writeFileSync(join(root, "strata-iq3_s.json"), JSON.stringify({ model_name: "qwen-iq3_s" }));
process.env.STRATA_ROOT = root;
const { discover, loadEngine, parseShow } = await import("./control.ts");

test("discovers one strata@ unit per safe run-<model>.sh", () => {
  const defs = discover().filter((d) => d.port === 8080);
  assert.deepEqual(defs.map((d) => d.unit), ["strata@iq3_s.service", "strata@iq3_xxs.service"]);
  assert.equal(defs[0]?.label, "qwen-iq3_s");
  assert.equal(defs[1]?.label, "iq3_xxs");
});

test("rejects engines that were not discovered", async () => {
  await assert.rejects(loadEngine("x;rm"), /Unknown Strata engine/);
  await assert.rejects(loadEngine("../etc"), /Unknown Strata engine/);
});

test("parses systemctl show blocks", () => {
  const units = parseShow(
    "Id=strata@a.service\nActiveState=active\nInactiveExitTimestamp=@1761300000\nResult=success\n\n" +
      "Id=strata@b.service\nActiveState=failed\nInactiveExitTimestamp=\nResult=exit-code\n",
  );
  assert.deepEqual(units.get("strata@a.service"), { activeState: "active", result: "success", sinceMs: 1761300000000 });
  assert.deepEqual(units.get("strata@b.service"), { activeState: "failed", result: "exit-code", sinceMs: null });
});
