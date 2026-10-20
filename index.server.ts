import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getSnapshot } from "./server/strata";
import { strataSnapshot } from "./shared/strata";

export default function contribute(server: PluginServerContext) {
  server.handle(strataSnapshot, () => getSnapshot());
  return () => {};
}
