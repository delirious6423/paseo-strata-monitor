import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Snapshot } from "../shared/strata";
import { Controls } from "./control";
import { useStrata } from "./snapshot";
import { Section } from "./section";

const HISTORY = 60;

const GIB = 1024 ** 3;
const fmt = (v: number | null, digits = 0, unit = "") => (v === null ? "–" : `${v.toFixed(digits)}${unit}`);
const gib = (v: number | null) => (v === null ? "–" : `${(v / GIB).toFixed(1)} GiB`);
const pct = (used: number | null, total: number | null) => (used === null || !total ? 0 : Math.min(1, used / total));

function Bar({ value, color, track }: { value: number; color: string; track: string }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: track, overflow: "hidden" }}>
      <View style={{ height: 6, width: `${Math.round(value * 100)}%`, backgroundColor: color }} />
    </View>
  );
}

export const makeStyles = (c: PluginTheme["colors"], compact: boolean) => ({
  compact,
  stack: { gap: compact ? 12 : 16 },
  screen: { flex: 1, backgroundColor: c.surface0 },
  body: { padding: compact ? 12 : 24, gap: compact ? 12 : 16, width: "100%" as const, maxWidth: 960, alignSelf: "center" as const },
  card: { padding: compact ? 12 : 24, gap: compact ? 8 : 16, borderRadius: 16, backgroundColor: c.surface1, minWidth: 0 },
  title: { color: c.foreground, fontSize: compact ? 16 : 20, fontWeight: "600" as const },
  big: { color: c.foreground, fontSize: compact ? 30 : 36, fontWeight: "600" as const },
  label: { color: c.foregroundMuted, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  value: { color: c.foreground, fontSize: compact ? 14 : 16, lineHeight: compact ? 20 : 24, flexShrink: 1 },
  row: { flexDirection: "row" as const, flexWrap: "wrap" as const, justifyContent: "space-between" as const, gap: 12 },
});
export type Styles = ReturnType<typeof makeStyles>;

export function Monitor({ theme, layout, openSettings }: PluginScreenProps & { openSettings?: () => void }) {
  const { data, error } = useStrata();

  const [history, setHistory] = useState<number[]>([]);
  const lastAt = useRef(0);
  useEffect(() => {
    if (!data || data.tokS === null) return;
    const now = Date.now();
    if (now - lastAt.current < 500) return;
    lastAt.current = now;
    setHistory((h) => [...h.slice(-(HISTORY - 1)), data.state === "generating" ? (data.tokS ?? 0) : 0]);
  }, [data]);

  const c = theme.colors;
  const styles = useMemo(() => makeStyles(c, layout.compact), [c, layout.compact]);

  return <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
    {data?.online ? <Online data={data} history={history} styles={styles} theme={theme} /> : null}
    <Controls theme={theme} styles={styles} openSettings={openSettings} />
    {data?.online ? <Diagnostics data={data} styles={styles} theme={theme} /> :
      <View style={styles.card}>
        <Text style={styles.title}>{data ? "Server offline" : "Connecting…"}</Text>
        <Text style={styles.label}>{error ? `Error: ${error.message}` : data?.error ?? "Checking the Strata server."}</Text>
      </View>}
  </ScrollView>;
}

function Stat({ styles, label, value }: { styles: Styles; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function Online({
  data, history, styles, theme,
}: { data: Snapshot; history: number[]; styles: Styles; theme: PluginTheme }) {
  const colors = theme.colors;
  const peak = Math.max(10, ...history);
  const busy = data.state === "generating";
  return (
      <View style={styles.card}>
        <Text style={styles.title}>{data.model ?? "Strata"}</Text>
        <Text style={styles.label}>
          {data.state ?? "unknown"}
          {data.phase && busy ? ` · ${data.phase}` : ""} · {data.url}
        </Text>
        <View style={styles.row}>
          <View>
            <Text style={styles.label}>Prefill{busy ? "" : " (last)"}</Text>
            <Text style={styles.big}>{fmt(busy && data.prefillTokSMean ? data.prefillTokSMean : data.lastPrefillTokS, 0)}</Text>
          </View>
          <View>
            <Text style={styles.label}>Decode{busy ? "" : " (last)"}</Text>
            <Text style={styles.big}>{fmt(busy ? data.tokS : data.lastDecodeTokS, 1)}</Text>
          </View>
          <Text style={styles.label}>tok/s</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 40, gap: 1 }}>
          {history.map((v, i) => (
            <View
              key={i}
              style={{ flex: 1, height: Math.max(1, (v / peak) * 40), backgroundColor: colors.accent, opacity: 0.4 + 0.6 * (i / history.length) }}
            />
          ))}
        </View>
        {busy ? (
          <>
            <Stat styles={styles} label="Generated" value={`${fmt(data.generated)} / ${fmt(data.maxTokens)}`} />
            <Stat styles={styles} label="Mean decode" value={fmt(data.tokSMean, 1, " tok/s")} />
            <Stat styles={styles} label="Mean prefill" value={fmt(data.prefillTokSMean, 0, " tok/s")} />
            <Stat styles={styles} label="Elapsed" value={fmt(data.elapsedS, 1, " s")} />
          </>
        ) : null}
        {data.servers.length > 1 ? (
          <Text style={styles.label}>
            Also running: {data.servers.filter((s) => s.url !== data.url).map((s) => `${s.model ?? "?"} (${s.url})`).join(", ")}
          </Text>
        ) : null}
        <Stat styles={styles} label="Queued" value={fmt(data.queued)} />
        <Stat styles={styles} label="Context" value={fmt(data.maxContext)} />
      </View>

  );
}

function Diagnostics({ data, styles, theme }: { data: Snapshot; styles: Styles; theme: PluginTheme }) {
  const colors = theme.colors;
  return <View style={styles.card}>
      <Section title="Hardware and request history" hint="Memory, utilization and recent requests" theme={theme} compact={styles.compact}>
      <View style={{ gap: 16 }}>
        <Text style={styles.title}>Hardware</Text>
        <Stat styles={styles} label="GPU" value={`${fmt(data.gpu.util, 0, "%")} · ${fmt(data.gpu.tempC, 0, "°C")} · ${fmt(data.gpu.powerW, 0, " W")}`} />
        <Bar value={pct(data.gpu.memUsed, data.gpu.memTotal)} color={colors.accent} track={colors.surface2 ?? colors.border} />
        <Stat styles={styles} label="VRAM" value={`${gib(data.gpu.memUsed)} / ${gib(data.gpu.memTotal)}`} />
        <Bar value={pct(data.gpu.ramUsed, data.gpu.ramTotal)} color={colors.accent} track={colors.surface2 ?? colors.border} />
        <Stat styles={styles} label="RAM" value={`${gib(data.gpu.ramUsed)} / ${gib(data.gpu.ramTotal)}`} />
        <Stat styles={styles} label="CPU" value={fmt(data.gpu.cpu, 0, "%")} />
      </View>

      <View style={{ gap: 16 }}>
        <Text style={styles.title}>Totals</Text>
        <Stat styles={styles} label="Requests" value={fmt(data.totals.requests)} />
        <Stat styles={styles} label="Prompt tokens" value={fmt(data.totals.promptTokens)} />
        <Stat styles={styles} label="Output tokens" value={fmt(data.totals.outputTokens)} />
      </View>

      <View style={{ gap: 16 }}>
        <Text style={styles.title}>Recent requests</Text>
        {data.recent.length === 0 ? <Text style={styles.label}>None yet</Text> : null}
        {data.recent.map((r, i) => (
          <Stat
            key={i}
            styles={styles}
            label={`${fmt(r.promptTokens)} → ${fmt(r.outputTokens)} · ${fmt(r.durationS, 1, " s")}`}
            value={`${fmt(r.tokS, 1, " tok/s")} ${r.finish ?? ""}`}
          />
        ))}
      </View>
      </Section>
      </View>;
}
