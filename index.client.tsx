import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEngines } from "./client/control";
import { Monitor } from "./client/monitor";
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
      ? changing ? `Strata ${changing.state} ${changing.id}…` : "Strata offline"
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
  client.addScreen({ id: "main", title: "Strata", Component: Monitor });
  client.addSidebarHeaderItem({ id: "main", title: "Strata", Component: StrataItem });
  return () => {};
}
