import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type Engine, strataEngines, strataLoad, strataStop } from "../shared/control";

const BUSY_MS = 1000;
const IDLE_MS = 3000;
const busy = (e: Engine) => e.state === "loading" || e.state === "stopping";

export function useEngines() {
  const engines = useRpc(strataEngines);
  return useQuery({
    queryKey: ["strata-engines"],
    queryFn: () => engines({}),
    refetchInterval: (query) => (query.state.data?.engines.some(busy) ? BUSY_MS : IDLE_MS),
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
      return `Loading${secs === null ? "" : ` · ${secs} s`} (usually 1–3 min)`;
    case "stopping":
      return "Stopping…";
    case "failed":
      return "Failed to start";
    default:
      return "Stopped";
  }
}

export function Controls({ theme, styles }: { theme: PluginTheme; styles: any }) {
  const c = theme.colors;
  const { data, error } = useEngines();
  const client = useQueryClient();
  const load = useRpc(strataLoad);
  const stop = useRpc(strataStop);
  const [picked, setPicked] = useState<string | null>(null);

  const action = useMutation({
    mutationFn: ({ kind, id }: { kind: "load" | "stop"; id: string }) => (kind === "load" ? load({ id }) : stop({ id })),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["strata-engines"] });
      void client.invalidateQueries({ queryKey: ["strata-snapshot"] });
    },
  });

  if (!data) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>{error ? `Engine control error: ${error.message}` : "Checking engines…"}</Text>
      </View>
    );
  }
  if (data.engines.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>No Strata engines found (no run-*.sh in STRATA_ROOT).</Text>
      </View>
    );
  }

  const running = data.engines.find((e) => e.state !== "stopped" && e.state !== "failed");
  const sel = data.engines.find((e) => e.id === picked) ?? running ?? data.engines[0]!;
  const other = running && running.id !== sel.id ? running : null;
  const kind: "load" | "stop" = sel.state === "loading" || sel.state === "ready" ? "stop" : "load";
  const label =
    action.isPending ? "Working…"
    : sel.state === "stopping" ? "Stopping…"
    : sel.state === "loading" ? "Abort"
    : sel.state === "ready" ? "Stop"
    : other ? "Switch to this model"
    : "Load";
  const disabled = action.isPending || sel.state === "stopping";
  const danger = kind === "stop";
  const dot = { ready: c.statusSuccess, loading: c.statusWarning, stopping: c.statusWarning, failed: c.statusDanger, stopped: c.border };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Engine</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {data.engines.map((e) => {
          const on = e.id === sel.id;
          return (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Select ${e.label}, ${e.state}`}
              onPress={() => setPicked(e.id)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10,
                borderRadius: 8, borderWidth: 1, borderColor: on ? c.accent : c.border,
                backgroundColor: on ? c.surface2 : "transparent",
              }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot[e.state] }} />
              <Text style={{ color: c.foreground, fontSize: 13 }}>{e.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>
        {status(sel)}
        {other ? ` · ${other.label} is ${other.state}; loading this stops it` : ""}
      </Text>
      {sel.error || action.error ? (
        <Text style={{ color: c.statusDanger, fontSize: 12 }}>{action.error?.message ?? sel.error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${sel.label}`}
        disabled={disabled}
        onPress={() => action.mutate({ kind, id: sel.id })}
        style={{
          paddingVertical: 10, borderRadius: 8, opacity: disabled ? 0.5 : 1,
          backgroundColor: danger ? c.statusDanger : c.accent,
        }}
      >
        <Text style={{ color: danger ? c.surface0 : c.accentForeground, textAlign: "center", fontWeight: "600" }}>{label}</Text>
      </Pressable>
    </View>
  );
}
