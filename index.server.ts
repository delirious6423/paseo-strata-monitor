import type { PluginServerContext } from "@getpaseo/plugin/server";
import { configure, knownPorts, listEngines, loadEngine, stopEngine } from "./server/control";
import { configureEndpoints, getSnapshot } from "./server/strata";
import { cancelJob, checkUpdate, disposeTools, startBench, startTune, startUpdate, toolsStatus } from "./server/tools";
import { discoverySettings, strataEngines, strataLoad, strataStop } from "./shared/control";
import { strataSnapshot } from "./shared/strata";
import { strataBench, strataCancel, strataTools, strataTune, strataUpdate, strataUpdateCheck } from "./shared/tools";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(discoverySettings);
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status !== "ready") return;
    configure({ extraFolders: state.values.extraFolders, useSystemd: state.values.useSystemd });
    configureEndpoints({ extraUrls: state.values.extraUrls });
  };
  configureEndpoints({ knownPorts });
  void settings.read().then(apply, (e) => console.error("strata: settings read failed", e));
  const unsubscribe = settings.subscribe(apply);

  server.handle(strataSnapshot, () => getSnapshot());
  server.handle(strataEngines, ({ rescan }) => listEngines(rescan));
  server.handle(strataLoad, async ({ id }) => {
    await loadEngine(id);
    return { ok: true as const };
  });
  server.handle(strataStop, async ({ id }) => {
    await stopEngine(id);
    return { ok: true as const };
  });
  const ok = { ok: true as const };
  server.handle(strataTools, () => toolsStatus());
  server.handle(strataBench, async ({ id }) => (await startBench(id), ok));
  server.handle(strataTune, async ({ id, mode }) => (await startTune(id, mode), ok));
  server.handle(strataUpdateCheck, () => checkUpdate(true));
  server.handle(strataUpdate, async () => (startUpdate(), ok));
  server.handle(strataCancel, async () => (await cancelJob(), ok));
  return () => {
    unsubscribe();
    disposeTools();
  };
}
