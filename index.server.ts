import type { PluginServerContext } from "@getpaseo/plugin/server";
import { configure, engineLog, knownPorts, listEngines, loadEngine, stopEngine } from "./server/control";
import { configureIdle, startIdle, stopIdle } from "./server/idle";
import { configureEndpoints, getSnapshot } from "./server/strata";
import {
  cancelJob, changePreset, checkUpdate, disposeTools, presetStatus, startBench, startRecheck, startRollback, startTools, startTune,
  startUpdate, toolsStatus,
} from "./server/tools";
import { discoverySettings, strataEngines, strataLoad, strataStop } from "./shared/control";
import { strataSnapshot } from "./shared/strata";
import {
  strataBench, strataCancel, strataLog, strataPresetChange, strataPresets, strataRecheck, strataRollback, strataTools, strataTune,
  strataUpdate, strataUpdateCheck,
} from "./shared/tools";

export default function contribute(server: PluginServerContext) {
  startTools(); // a reload into the same module instance starts with the tools usable again
  const settings = server.registerSettings(discoverySettings);
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status !== "ready") return;
    configure({ extraFolders: state.values.extraFolders, useSystemd: state.values.useSystemd });
    configureEndpoints({ extraUrls: state.values.extraUrls });
    configureIdle(state.values.idleStopMinutes);
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
  server.handle(strataUpdate, async () => (await startUpdate(), ok));
  server.handle(strataCancel, async () => (await cancelJob(), ok));
  server.handle(strataRollback, async () => (await startRollback(), ok));
  server.handle(strataPresets, ({ id }) => presetStatus(id));
  server.handle(strataPresetChange, ({ id, action, preset }) => changePreset(id, action, preset));
  server.handle(strataRecheck, async ({ id, preset }) => (await startRecheck(id, preset), ok));
  server.handle(strataLog, ({ id }) => engineLog(id));
  startIdle();
  return () => {
    unsubscribe();
    stopIdle();
    disposeTools();
  };
}
