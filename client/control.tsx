import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type Engine, strataEngines, strataLoad, strataStop } from "../shared/control";
import { gb, groupEngines } from "../shared/group";
import type { Styles } from "./monitor";
import { useStrata } from "./snapshot";

const BUSY_MS = 1000;
const IDLE_MS = 3000;
const busy = (e: Engine) => e.state === "loading" || e.state === "stopping";

/** `idleMs`: the screen polls every 3 s; the sidebar row only needs to notice a load starting, so slower. */
export function useEngines(idleMs = IDLE_MS) {
  const engines = useRpc(strataEngines);
  return useQuery({
    queryKey: ["strata-engines"],
    queryFn: () => engines({}),
    refetchInterval: (query) => (query.state.data?.engines.some(busy) ? BUSY_MS : idleMs),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

function status(e: Engine): string {
  const secs = e.sinceMs ? Math.max(0, Math.round((Date.now() - e.sinceMs) / 1000)) : null;
  switch (e.state) {
    case "ready":
      return `Ready on port ${e.port}`;
    case "loading":
      return `Loading${secs === null ? "" : ` · ${secs} s`}`;
    case "stopping":
      return "Stopping…";
    case "failed":
      return "Failed to start";
    default:
      return "Stopped";
  }
}

export function Controls({ theme, styles, openSettings }: { theme: PluginTheme; styles: Styles; openSettings?: () => void }) {
  const c = theme.colors;
  const { data, error } = useEngines();
  const { data: snapshot } = useStrata();
  const client = useQueryClient();
  const engines = useRpc(strataEngines); // the same RPC as useEngines, called with rescan
  const load = useRpc(strataLoad);
  const stop = useRpc(strataStop);
  const [picked, setPicked] = useState<string | null>(null);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["strata-engines"] });
    void client.invalidateQueries({ queryKey: ["strata-snapshot"] });
  };
  const action = useMutation({
    mutationFn: ({ kind, id }: { kind: "load" | "stop"; id: string }) => (kind === "load" ? load({ id }) : stop({ id })),
    onSettled: refresh,
  });
  const rescan = useMutation({
    mutationFn: () => engines({ rescan: true }),
    onSuccess: (next) => client.setQueryData(["strata-engines"], next),
  });

  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Text style={{ color: c.accent, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  if (!data) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>{error ? `Model discovery error: ${error.message}` : "Looking for Strata models…"}</Text>
      </View>
    );
  }
  const searched = data.places.length;
  const footer = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Text style={styles.label}>
        {data.engines.length} models · searched {searched} {searched === 1 ? "place" : "places"}
      </Text>
      {link(rescan.isPending ? "Searching…" : "Search again", () => rescan.mutate())}
      {openSettings ? link("Add folders or servers", openSettings) : null}
    </View>
  );
  if (data.engines.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Engine</Text>
        <Text style={styles.label}>
          No Strata models found. Install Strata and a model, or add a folder with Strata run configs in the plugin settings.
        </Text>
        {data.places.map((p) => (
          <Text key={p.source + p.path} style={styles.label}>
            {p.source}: {p.path}
            {p.note ? ` (${p.note})` : ""}
          </Text>
        ))}
        {footer}
      </View>
    );
  }

  const running = data.engines.find((e) => e.state !== "stopped" && e.state !== "failed");
  // A Strata server on this machine that no listed model accounts for (started elsewhere): Load would be refused.
  const ours = new Set(data.engines.filter((e) => e.state !== "stopped").map((e) => e.port));
  const elsewhere = (snapshot?.servers ?? []).filter((s) => {
    const m = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)$/.exec(s.url);
    return m && !ours.has(Number(m[1]));
  });
  const sel = data.engines.find((e) => e.id === picked) ?? running ?? groupEngines(data.engines)[0]!.engines[0]!;
  const other = running && running.id !== sel.id ? running : null;
  const kind: "load" | "stop" = sel.state === "loading" || sel.state === "ready" ? "stop" : "load";
  const label =
    action.isPending ? "Working…"
    : sel.state === "stopping" ? "Stopping…"
    : sel.state === "loading" ? "Abort"
    : sel.state === "ready" ? "Stop"
    : elsewhere.length ? "Another Strata server is running"
    : other ? "Switch to this model"
    : "Load";
  const disabled = action.isPending || sel.state === "stopping" || (kind === "load" && elsewhere.length > 0);
  const danger = kind === "stop";
  const dot = { ready: c.statusSuccess, loading: c.statusWarning, stopping: c.statusWarning, failed: c.statusDanger, stopped: c.border };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Engine</Text>
      {groupEngines(data.engines).map((g) => (
        <View key={g.title} style={{ gap: 6 }}>
          <Text style={[styles.label, { fontSize: 12 }]}>{g.title}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {g.engines.map((e) => {
              const on = e.id === sel.id;
              return (
                <Pressable
                  key={e.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Select ${e.provider} ${e.quant}, ${gb(e.sizeBytes)}, ${e.state}`}
                  onPress={() => setPicked(e.id)}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10,
                    borderRadius: 8, borderWidth: 1, borderColor: on ? c.accent : c.border,
                    backgroundColor: on ? c.surface2 : "transparent",
                  }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot[e.state] }} />
                  <Text style={{ color: c.foreground, fontSize: 13 }}>{e.quant}</Text>
                  <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{gb(e.sizeBytes)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Text style={styles.value}>
        {sel.family} · {sel.provider} · {sel.quant} · {gb(sel.sizeBytes)}
      </Text>
      <Text style={styles.label}>
        {status(sel)}
        {other ? ` · ${other.provider} ${other.quant} is ${other.state}; loading this stops it` : ""}
      </Text>
      {elsewhere.length ? (
        <Text style={{ color: c.statusWarning, fontSize: 12 }}>
          Running outside this plugin: {elsewhere.map((s) => `${s.model ?? "Strata"} at ${s.url}`).join(", ")}. Stop it where it was
          started (Strata app, terminal or service) to load a model here.
        </Text>
      ) : null}
      <Text style={[styles.label, { fontSize: 12 }]}>
        {sel.name} · {sel.launcher}
      </Text>
      {sel.error || action.error ? (
        <Text style={{ color: c.statusDanger, fontSize: 12 }}>{action.error?.message ?? sel.error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${sel.provider} ${sel.quant}`}
        disabled={disabled}
        onPress={() => action.mutate({ kind, id: sel.id })}
        style={{
          paddingVertical: 10, borderRadius: 8, opacity: disabled ? 0.5 : 1,
          backgroundColor: danger ? c.statusDanger : c.accent,
        }}
      >
        <Text style={{ color: danger ? c.surface0 : c.accentForeground, textAlign: "center", fontWeight: "600" }}>{label}</Text>
      </Pressable>
      {footer}
    </View>
  );
}
