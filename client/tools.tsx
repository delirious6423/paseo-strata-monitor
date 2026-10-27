import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Engine } from "../shared/control";
import { type Job, strataBench, strataCancel, strataRollback, strataTools, strataTune, strataUpdate, strataUpdateCheck } from "../shared/tools";
import { Presets } from "./extras";
import { ModelConfig } from "./model-config";
import { PresetAdmin } from "./preset-admin";
import { Section } from "./section";
import { benchOptionsSchema, tuneGoalMismatch, tuneOptionsSchema } from "../shared/options";
import { BenchSettings, TuneSettings } from "./tool-options";
import type { Styles } from "./monitor";

const KIND = { bench: "Benchmark", tune: "Autotune", update: "Update", recheck: "Re-check", rollback: "Undo update", idle: "Idle stop" } as const;
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
  const rollback = useRpc(strataRollback);
  const cancel = useRpc(strataCancel);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["strata-tools"] });
    void client.invalidateQueries({ queryKey: ["strata-engines"] });
  };
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSettled: refresh });
  const checking = useMutation({ mutationFn: () => check({}), onSettled: refresh });

  // A second press confirms the long or disruptive actions; the question goes away after 6 s, or when another
  // model is selected (a confirmed Autotune must be for the model it was asked about).
  const [tuneMode, setTuneMode] = useState<"quick" | "thorough">("quick");
  const [tuneOptions, setTuneOptions] = useState(() => tuneOptionsSchema.parse({}));
  const [benchOptions, setBenchOptions] = useState(() => benchOptionsSchema.parse({}));
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});
  const tuneValidation = tuneOptionsSchema.safeParse(tuneOptions);
  const benchValidation = benchOptionsSchema.safeParse(benchOptions);
  const tuneMismatch = tuneValidation.success ? tuneGoalMismatch(sel.resourceProfile, tuneValidation.data) : null;
  const tuneKey = `tune:${sel.id}:${tuneMode}:${JSON.stringify(tuneOptions)}`;
  const benchKey = `bench:${sel.id}:${JSON.stringify(benchOptions)}`;
  const [asked, setConfirm] = useState<string | null>(null);
  const confirm = asked === tuneKey ? "tune" : asked === "update" || asked === "rollback" ? asked : null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ask = (kind: "tune" | "bench" | "update" | "rollback", run: () => void) => {
    const what = kind === "tune" ? tuneKey : kind === "bench" ? benchKey : kind;
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
        minHeight: 48, maxWidth: "100%", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, opacity: opts.disabled ? 0.45 : 1,
        borderColor: opts.warn ? c.statusWarning : c.border, backgroundColor: opts.warn ? c.surface2 : "transparent",
      }}
    >
      <Text style={{ color: c.foreground, fontSize: 16, lineHeight: 24 }}>{label}</Text>
    </Pressable>
  );

  const busy = !!running || act.isPending;
  const u = data?.update ?? null;
  return (
    <View style={styles.stack}>
      {running ? <View style={styles.card}><Running job={running} theme={theme} styles={styles} onCancel={() => act.mutate(() => cancel({}))} /></View> : null}
      {act.error || checking.error ? <Text style={{ color: c.statusDanger, fontSize: 14 }}>{(act.error ?? checking.error)?.message}</Text> : null}
      <View style={styles.card}>
      <Section title="Tuning and benchmarks" hint="Measure speed or find better settings" theme={theme} compact={styles.compact}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Autotune depth" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["quick", "thorough"] as const).map((mode) => (
          <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: tuneMode === mode, disabled: busy }}
            accessibilityLabel={mode === "quick" ? "Quick autotune" : "Thorough autotune"} disabled={busy}
            onPress={() => { setTuneMode(mode); setConfirm(null); }}
            style={{ minHeight: 48, justifyContent: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
              opacity: busy ? 0.45 : 1, borderColor: tuneMode === mode ? c.accent : c.border,
              backgroundColor: tuneMode === mode ? c.surface2 : "transparent" }}>
            <Text style={{ color: c.foreground, fontSize: 14 }}>{mode === "quick" ? "Quick · up to 20 min" : "Thorough · up to 2 h"}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>
        {tuneMode === "quick" ? "Quick tests a smaller set of settings." : "Thorough also tests settings such as CPU workers and memory allocation, with more repeated comparisons."}
        {" "}{tuneOptions.allowSmallDifferences || tuneOptions.allowNotRepeatable ? "Answer differences are enabled in tuning options." : "Answer differences are off."} No gain means no faster settings found in this search, not proof of optimality.
      </Text>
      <TuneSettings theme={theme} disabled={busy} value={tuneOptions} onChange={setTuneOptions} />
      <BenchSettings theme={theme} disabled={busy} value={benchOptions} onChange={setBenchOptions} />
      {!tuneValidation.success ? <Text style={{ color: c.statusDanger }}>{tuneValidation.error.issues[0]?.message}</Text> : null}
      {!benchValidation.success ? <Text style={{ color: c.statusDanger }}>{benchValidation.error.issues[0]?.message}</Text> : null}
      {tuneMismatch ? <Text style={{ color: c.statusWarning, fontSize: 14 }}>{tuneMismatch}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {button(asked === benchKey ? `Press again: run ${benchOptions.suite}` : `Benchmark · ${benchOptions.suite}`,
          () => ask("bench", () => act.mutate(() => bench({ id: sel.id, options: benchOptions }))), { disabled: busy || sel.state !== "ready" || !benchValidation.success })}
        {button(confirm === "tune"
          ? `Press again: ${tuneOptions.minutes !== null ? `up to ${tuneOptions.minutes} min` : tuneMode === "quick" ? "up to 20 min" : "up to 2 h"}${tuneOptions.allowSmallDifferences || tuneOptions.allowNotRepeatable ? ", answers may change" : ""}${sel.state === "ready" ? tuneOptions.save ? ", restarts the model, speed before/after" : ", restarts with previous settings, no before/after comparison" : ", stops the running model"}${sel.keepsTuning === false ? ", result not kept" : ""}`
          : `Autotune ${tuneMode}`,
          () => ask("tune", () => act.mutate(() => tune({ id: sel.id, mode: tuneMode, options: tuneOptions }))), { disabled: busy || !tuneValidation.success || tuneMismatch !== null, warn: confirm === "tune" })}
      </View>
      {sel.keepsTuning === false ? (
        <Text style={{ color: c.statusWarning, fontSize: 12 }}>
          This model's server does not apply saved tuning (it runs a Strata copy without presets), so an Autotune result
          would not be used when it starts. Benchmark still works.
        </Text>
      ) : null}
      {sel.state !== "ready" && !running ? (
        <Text style={[styles.label, { fontSize: 12 }]}>Benchmark measures the running model: load it first.</Text>
      ) : null}
      </Section>
      </View>
      <View style={styles.card}>
      <Section title="Configuration and presets" hint="Launch settings and saved tuning" theme={theme} compact={styles.compact}>
      <ModelConfig theme={theme} styles={styles} sel={sel} busy={busy} />
      <Presets theme={theme} styles={styles} sel={sel} busy={busy} mutationBusy={act.isPending || (!!running && running.kind !== "bench")} />
      <PresetAdmin key={sel.id} theme={theme} styles={styles} sel={sel} busy={act.isPending || (!!running && running.kind !== "bench")} />

      </Section>
      </View>
      <View style={styles.card}>
      <Section title="Activity and updates" hint="Recent results and engine maintenance" theme={theme} compact={styles.compact}>
      {button(checking.isPending ? "Checking…" : "Check for updates", () => checking.mutate(), { disabled: busy || checking.isPending })}
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
          {u.previous
            ? button(confirm === "rollback" ? `Press again: stops the model, back to ${u.previous}` : `Undo update (back to ${u.previous})`,
                () => ask("rollback", () => act.mutate(() => rollback({}))), { disabled: busy, warn: confirm === "rollback" })
            : null}
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
          {j.details.length ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: !!expandedJobs[j.id] }}
            onPress={() => setExpandedJobs((v) => ({ ...v, [j.id]: !v[j.id] }))}>
            <Text style={{ color: c.accent, fontSize: 14 }}>{expandedJobs[j.id] ? "Hide" : "Show"} details ({j.details.length})</Text>
          </Pressable> : null}
          {expandedJobs[j.id] ? j.details.map((d, i) => (
            <Text key={i} selectable style={[styles.label, { fontSize: 12 }]}>{d}</Text>
          )) : null}
        </View>
      ))}
      </Section>
      </View>
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
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={{ alignSelf: "flex-start", minHeight: 48, paddingHorizontal: 12, justifyContent: "center" }}>
        <Text style={{ color: c.statusDanger, fontSize: 13 }}>Cancel</Text>
      </Pressable>
    </View>
  );
}
