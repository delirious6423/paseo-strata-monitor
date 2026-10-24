import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Engine } from "../shared/control";
import { type Job, strataBench, strataCancel, strataTools, strataTune, strataUpdate, strataUpdateCheck } from "../shared/tools";
import type { Styles } from "./monitor";

const KIND = { bench: "Benchmark", tune: "Autotune", update: "Update" } as const;
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const mb = (b: number | null) => (b ? `${Math.round(b / 1e6)} MB` : "size unknown");

/** Benchmark, Autotune and Update for the selected model, under the model picker. */
export function Tools({ theme, styles, sel }: { theme: PluginTheme; styles: Styles; sel: Engine }) {
  const c = theme.colors;
  const client = useQueryClient();
  const tools = useRpc(strataTools);
  const { data } = useQuery({
    queryKey: ["strata-tools"],
    queryFn: () => tools({}),
    refetchInterval: (q) => (q.state.data?.job ? 1000 : 10_000),
    refetchIntervalInBackground: false,
  });
  const bench = useRpc(strataBench);
  const tune = useRpc(strataTune);
  const check = useRpc(strataUpdateCheck);
  const update = useRpc(strataUpdate);
  const cancel = useRpc(strataCancel);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["strata-tools"] });
    void client.invalidateQueries({ queryKey: ["strata-engines"] });
  };
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSettled: refresh });
  const checking = useMutation({ mutationFn: () => check({}), onSettled: refresh });

  // A second press confirms the long or disruptive actions; the question goes away after 6 s, or when another
  // model is selected (a confirmed Autotune must be for the model it was asked about).
  const [asked, setConfirm] = useState<string | null>(null);
  const confirm = asked === `tune:${sel.id}` ? "tune" : asked === "update" ? "update" : null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ask = (kind: "tune" | "update", run: () => void) => {
    const what = kind === "tune" ? `tune:${sel.id}` : kind;
    if (asked === what) {
      setConfirm(null);
      run();
      return;
    }
    setConfirm(what);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirm(null), 6000);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // When a job ends, the model list changes too (autotune stopped the model; an update swapped the engine).
  const running = data?.job ?? null;
  const was = useRef<string | null>(null);
  useEffect(() => {
    if (was.current && !running) void client.invalidateQueries({ queryKey: ["strata-engines"] });
    was.current = running?.id ?? null;
  }, [running, client]);

  const button = (label: string, onPress: () => void, opts: { disabled?: boolean; warn?: boolean } = {}) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={opts.disabled}
      onPress={onPress}
      style={{
        paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, opacity: opts.disabled ? 0.45 : 1,
        borderColor: opts.warn ? c.statusWarning : c.border, backgroundColor: opts.warn ? c.surface2 : "transparent",
      }}
    >
      <Text style={{ color: c.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  const busy = !!running || act.isPending;
  const u = data?.update ?? null;
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
      <Text style={[styles.label, { fontSize: 12 }]}>Tools · {sel.provider} {sel.quant}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {button("Benchmark", () => act.mutate(() => bench({ id: sel.id })), { disabled: busy || sel.state !== "ready" })}
        {button(confirm === "tune" ? "Press again: stops the model, ~20 min" : "Autotune",
          () => ask("tune", () => act.mutate(() => tune({ id: sel.id, mode: "quick" }))), { disabled: busy, warn: confirm === "tune" })}
        {button(checking.isPending ? "Checking…" : "Check for updates", () => checking.mutate(), { disabled: busy || checking.isPending })}
      </View>
      {sel.state !== "ready" && !running ? (
        <Text style={[styles.label, { fontSize: 12 }]}>Benchmark measures the running model: load it first.</Text>
      ) : null}
      {act.error || checking.error ? (
        <Text style={{ color: c.statusDanger, fontSize: 12 }}>{(act.error ?? checking.error)?.message}</Text>
      ) : null}

      {running ? <Running job={running} theme={theme} styles={styles} onCancel={() => act.mutate(() => cancel({}))} /> : null}

      {u ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.value}>
            Engine {u.engine.installed ?? "not installed"}
            {u.engine.offered && u.engine.offered !== u.engine.installed ? ` → ${u.engine.offered}` : ""} · Control{" "}
            {u.control.installed ?? "not installed"}
            {u.control.offered && u.control.offered !== u.control.installed ? ` → ${u.control.offered}` : ""}
          </Text>
          <Text style={[styles.label, { fontSize: 12 }]}>
            {u.available ? `Update available (download ${mb(u.downloadBytes)})` : "Up to date"} · checked {ago(u.checkedMs)}
          </Text>
          {!u.reachesModels ? (
            <Text style={{ color: c.statusWarning, fontSize: 12 }}>
              None of the models found here runs Strata's installed engine (their run configs start their own engine
              files), so an update would not change them.
            </Text>
          ) : null}
          {u.available
            ? button(confirm === "update" ? `Press again: stops the model, downloads ${mb(u.downloadBytes)}` : "Install update",
                () => ask("update", () => act.mutate(() => update({}))), { disabled: busy, warn: confirm === "update" })
            : null}
        </View>
      ) : null}

      {(data?.history ?? []).slice(0, 3).map((j) => (
        <View key={j.id} style={{ gap: 2 }}>
          <Text style={[styles.label, { fontSize: 12 }]}>
            {KIND[j.kind]}
            {j.model ? ` · ${j.model}` : ""} · {ago(j.endedMs ?? j.startedMs)}
          </Text>
          <Text numberOfLines={4} style={{ color: j.state === "failed" ? c.statusDanger : c.foreground, fontSize: 13 }}>
            {j.state === "failed" ? `Failed: ${j.error}` : j.outcome}
          </Text>
          {j.details.map((d, i) => (
            <Text key={i} style={[styles.label, { fontSize: 12 }]}>
              {d}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Running({ job, theme, styles, onCancel }: { job: Job; theme: PluginTheme; styles: Styles; onCancel: () => void }) {
  const c = theme.colors;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.value}>
        {KIND[job.kind]}
        {job.model ? ` · ${job.model}` : ""}
        {job.pct !== null ? ` · ${job.pct}%` : ""}
        {job.minutesLeft ? ` · about ${job.minutesLeft} min left` : ""}
      </Text>
      <Text style={[styles.label, { fontSize: 12 }]}>{job.message}</Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: "hidden" }}>
        <View style={{ height: 6, width: `${job.pct ?? 5}%`, backgroundColor: c.accent }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={{ alignSelf: "flex-start" }}>
        <Text style={{ color: c.statusDanger, fontSize: 13 }}>Cancel</Text>
      </Pressable>
    </View>
  );
}
