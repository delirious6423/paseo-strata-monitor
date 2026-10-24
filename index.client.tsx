import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEngines } from "./client/control";
import { Monitor } from "./client/monitor";
import { DiscoverySettings } from "./client/settings";
import { useStrata } from "./client/snapshot";

const n = (v: number | null | undefined) => (v ? Math.round(v) : "–");

// Always visible in the sidebar: speeds in the label, click opens the detail screen.
function StrataItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const { data } = useStrata();
  const changing = useEngines().data?.engines.find((e) => e.state === "loading" || e.state === "stopping");
  const busy = data?.state === "generating";
  const label = !data
    ? "Strata"
    : !data.online
      ? changing ? `Strata ${changing.state} ${changing.quant}…` : "Strata offline"
      : busy
        ? `● P ${n(data.prefillTokSMean ?? data.lastPrefillTokS)} · D ${n(data.tokS)}`
        : `○ P ${n(data.lastPrefillTokS)} · D ${n(data.lastDecodeTokS)}`;
  return (
    <SidebarRow
      icon="Activity"
      label={label}
      active={currentScreen?.screenId === "main"}
      onPress={() => openScreen({ screenId: "main" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings("discovery");
  client.addScreen({ id: "main", title: "Strata", Component: (props) => <Monitor {...props} openSettings={openSettings} /> });
  client.addSettingsScreen({ id: "discovery", title: "Model discovery", icon: "FolderSearch", Component: DiscoverySettings });
  client.addSidebarHeaderItem({ id: "main", title: "Strata", Component: StrataItem });
  return () => {};
}
