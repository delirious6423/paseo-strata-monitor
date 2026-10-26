import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Engine } from "../shared/control";
import { strataLog, strataPresetChange, strataPresets, strataRecheck } from "../shared/tools";
import type { Styles } from "./monitor";

const link = (theme: PluginTheme, label: string, onPress: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={opts.disabled} onPress={onPress}
    style={{ paddingVertical: 4, paddingHorizontal: 2, opacity: opts.disabled ? 0.45 : 1 }}>
    <Text style={{ color: opts.danger ? theme.colors.statusDanger : theme.colors.accent, fontSize: 13 }}>{label}</Text>
  </Pressable>
);

const STATE = {
  fresh: "used at every start",
  soft: "used at start, but this PC or the engine changed since it was saved: a re-check is advised",
  hard: "not used: this PC or the engine changed too much; run Autotune again",
} as Record<string, string>;

/** The saved tunes for the selected model (Strata's presets): which one starts with the model, and switch off,
 * undo, use another, delete, or re-check. Changes take effect at the model's next start. */
export function Presets({ theme, styles, sel, busy, mutationBusy = busy }: { theme: PluginTheme; styles: Styles; sel: Engine; busy: boolean; mutationBusy?: boolean }) {
  const c = theme.colors;
  const client = useQueryClient();
  const status = useRpc(strataPresets);
  const change = useRpc(strataPresetChange);
  const recheck = useRpc(strataRecheck);
  const key = ["strata-presets", sel.id];
  const { data, error, isLoading } = useQuery({ queryKey: key, queryFn: () => status({ id: sel.id }), enabled: sel.keepsTuning !== false,
    refetchInterval: busy ? false : 60_000 });
  // A tool that ends (autotune, re-check) may have changed the presets.
  useEffect(() => {
    if (!busy) void client.invalidateQueries({ queryKey: key });
  }, [busy]);
  const act = useMutation({
    mutationFn: (a: { action: "off" | "undo" | "apply" | "delete"; preset?: string }) => change({ id: sel.id, ...a }),
    onSuccess: (d) => client.setQueryData(key, d),
  });
  const check = useMutation({ mutationFn: (preset: string) => recheck({ id: sel.id, preset }),
    onSettled: () => void client.invalidateQueries({ queryKey: ["strata-tools"] }) });
  // Delete and Re-check (it stops the running model) need a second press, like Autotune.
  const [confirm, setConfirm] = useState<string | null>(null);
  const twice = (what: string, run: () => void) => {
    if (confirm !== what) return setConfirm(what);
    setConfirm(null);
    run();
  };
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), 6000);
    return () => clearTimeout(t);
  }, [confirm]);

  if (sel.keepsTuning === false) return null; // the warning above already says a tune is not used
  const active = data?.presets.find((p) => p.active) ?? null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={[styles.label, { fontSize: 12 }]}>Saved tuning</Text>
      {isLoading ? <Text style={[styles.label, { fontSize: 12 }]}>Reading…</Text> : null}
      {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error.message}</Text> : null}
      {data && !data.presets.length ? (
        <Text style={[styles.label, { fontSize: 12 }]}>None yet: the model starts with its run config as written. Autotune saves one.</Text>
      ) : null}
      {data && data.presets.length ? (
        <Text style={{ color: data.state === "fresh" || !active ? c.foreground : c.statusWarning, fontSize: 13 }}>
          {active ? `"${active.name}" ${STATE[data.state ?? ""] ?? "is the active one"}` : data.switchedOff
            ? "Switched off: the model starts with the standard settings" : "None active: the model starts with the standard settings"}
        </Text>
      ) : null}
      {data?.reasons.length ? <Text style={[styles.label, { fontSize: 12 }]}>{data.reasons.join("; ")}</Text> : null}
      {(data?.presets ?? []).map((p) => (
        <View key={p.id} style={{ gap: 0 }}>
          <Text style={{ color: c.foreground, fontSize: 13 }}>
            {p.active ? "● " : "○ "}
            {p.name}
            {p.gainPct !== null ? ` · ${p.gainPct >= 0 ? "+" : ""}${p.gainPct.toFixed(1)}% vs standard` : ""}
            {p.decodeTokS !== null ? ` · ${p.decodeTokS.toFixed(1)} tok/s` : ""}
          </Text>
          {p.notice || p.created ? (
            <Text style={[styles.label, { fontSize: 12 }]}>
              {[p.created?.slice(0, 10), p.notice, p.lastRecheck ? `re-checked ${p.lastRecheck.slice(0, 10)}` : null].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {!p.active ? link(theme, "Use this one", () => act.mutate({ action: "apply", preset: p.id }), { disabled: act.isPending || mutationBusy }) : null}
            {link(theme, confirm === `recheck:${p.id}` ? "Press again: stops the model, ~2 min" : "Re-check",
              () => twice(`recheck:${p.id}`, () => check.mutate(p.id)), { disabled: check.isPending || busy })}
            {link(theme, confirm === `delete:${p.id}` ? "Press again to delete" : "Delete",
              () => twice(`delete:${p.id}`, () => act.mutate({ action: "delete", preset: p.id })), { disabled: act.isPending || mutationBusy, danger: true })}
          </View>
        </View>
      ))}
      {data && data.presets.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {active ? link(theme, "Switch off", () => act.mutate({ action: "off" }), { disabled: act.isPending || mutationBusy }) : null}
          {data.canUndo ? link(theme, "Undo last change", () => act.mutate({ action: "undo" }), { disabled: act.isPending || mutationBusy }) : null}
        </View>
      ) : null}
      {act.error || check.error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{(act.error ?? check.error)?.message}</Text> : null}
    </View>
  );
}

/** The selected model's server log stays collapsed, including after a failed start. */
export function ServerLog({ theme, styles, sel }: { theme: PluginTheme; styles: Styles; sel: Engine }) {
  const c = theme.colors;
  const log = useRpc(strataLog);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [sel.id]);
  const live = sel.state === "loading" || sel.state === "stopping";
  const { data, error } = useQuery({ queryKey: ["strata-log", sel.id], queryFn: () => log({ id: sel.id }), enabled: open,
    refetchInterval: open && live ? 3000 : false });
  return (
    <View style={{ gap: 4 }}>
      {link(theme, open ? "Hide server log" : "Show server log", () => setOpen(!open))}
      {open ? (
        <View style={{ gap: 2, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8, backgroundColor: c.surface2 }}>
          {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error.message}</Text> : null}
          {data && !data.lines.length ? <Text style={[styles.label, { fontSize: 12 }]}>Nothing logged yet.</Text> : null}
          {(data?.lines ?? []).slice(-20).map((l, i) => (
            <Text key={i} selectable style={{ color: c.foreground, fontSize: 11, fontFamily: "monospace" }}>{l}</Text>
          ))}
          {data ? <Text selectable style={[styles.label, { fontSize: 11 }]}>{data.source}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
