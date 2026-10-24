import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listEngines, loadEngine, stopEngine } from "./server/control";
import { getSnapshot } from "./server/strata";
import { strataEngines, strataLoad, strataStop } from "./shared/control";
import { strataSnapshot } from "./shared/strata";

export default function contribute(server: PluginServerContext) {
  server.handle(strataSnapshot, () => getSnapshot());
  server.handle(strataEngines, async () => ({ engines: await listEngines() }));
  server.handle(strataLoad, async ({ id }) => {
    await loadEngine(id);
    return { ok: true as const };
  });
  server.handle(strataStop, async ({ id }) => {
    await stopEngine(id);
    return { ok: true as const };
  });
  return () => {};
}
