import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { Engine } from "../shared/control";
import { PRESET_JSON_LIMIT, presetName, strataPresetDetails, strataPresetEffective, strataPresetExport, strataPresetImport, strataPresetRename } from "../shared/preset-admin";
import { strataPresets } from "../shared/tools";
import type { Styles } from "./monitor";

/** Bookkeeping only. Apply, delete and recheck remain in Saved tuning. */
export function PresetAdmin({ theme, styles, sel, busy }: { theme: PluginTheme; styles: Styles; sel: Engine; busy: boolean }) {
  const c = theme.colors;
  const cache = useQueryClient();
  const list = useRpc(strataPresets);
  const show = useRpc(strataPresetDetails);
  const exportJson = useRpc(strataPresetExport);
  const rename = useRpc(strataPresetRename);
  const importJson = useRpc(strataPresetImport);
  const effective = useRpc(strataPresetEffective);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState("");
  const [name, setName] = useState("");
  const [pasted, setPasted] = useState("");
  const [evidence, setEvidence] = useState(false);
  const [exported, setExported] = useState("");
  const [notice, setNotice] = useState("");
  const key = ["strata-presets", sel.id];
  const { data: status, error: listError, isLoading } = useQuery({ queryKey: key, queryFn: () => list({ id: sel.id }), enabled: open && sel.keepsTuning !== false });
  const selected = status?.presets.find((p) => p.id === preset);
  const details = useQuery({ queryKey: ["strata-preset-details", sel.id, preset], queryFn: () => show({ id: sel.id, preset }), enabled: open && !!selected });
  const settings = useQuery({ queryKey: ["strata-preset-effective", sel.id], queryFn: () => effective({ id: sel.id }), enabled: open && sel.keepsTuning !== false });
  const refresh = async () => {
    await Promise.all([cache.invalidateQueries({ queryKey: key }), cache.invalidateQueries({ queryKey: ["strata-preset-details", sel.id] }), cache.invalidateQueries({ queryKey: ["strata-preset-effective", sel.id] })]);
  };
  const renameAction = useMutation({ mutationFn: () => rename({ id: sel.id, preset, name: name.trim() }), onSuccess: async () => { setNotice("Preset renamed."); await refresh(); } });
  const importAction = useMutation({ mutationFn: () => importJson({ id: sel.id, json: pasted }), onSuccess: async (d) => {
    setPasted(""); setNotice(`Imported “${d.name}”. It is not applied.${d.visible ? " Use Saved tuning to apply it at the next start." : " Refresh the model's preset list to find it."}`); await refresh();
  } });
  const exportAction = useMutation({ mutationFn: () => exportJson({ id: sel.id, preset }), onSuccess: (d) => { setExported(d.json); setNotice("Export ready. Credential fields are redacted; review before sharing."); } });
  useEffect(() => {
    setOpen(false); setPreset(""); setName(""); setPasted(""); setExported(""); setNotice(""); setEvidence(false);
    renameAction.reset(); importAction.reset(); exportAction.reset();
  }, [sel.id]);
  useEffect(() => { setName(selected?.name ?? ""); setExported(""); setEvidence(false); }, [preset, selected?.name]);
  useEffect(() => { if (!busy && open) void refresh(); }, [busy, open]);
  const pending = busy || renameAction.isPending || importAction.isPending || exportAction.isPending;
  const text = { color: c.foreground, fontSize: 14, lineHeight: 20 };
  const input = { ...text, fontSize: 16, minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8, backgroundColor: c.surface2 };
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={action}
      style={({ pressed, hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) => ({ minHeight: 48, maxWidth: "100%", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: focused ? c.accent : c.border, backgroundColor: pressed || hovered ? c.surface2 : "transparent", opacity: disabled ? 0.45 : 1 })}>
      <Text style={{ color: c.accent, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const error = listError ?? details.error ?? settings.error ?? renameAction.error ?? importAction.error ?? exportAction.error;
  let detail: Record<string, unknown> | null = null;
  if (details.data && selected) { try { detail = JSON.parse(details.data.json); } catch {} }
  const { evidence: trials, ...summary } = detail ?? {};
  if (sel.keepsTuning === false) return null;
  return <View style={{ gap: 8 }}>
    {button(open ? "Hide preset management" : "Manage preset details and JSON", () => setOpen(!open))}
    {open ? <View style={{ gap: 12, padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}>
      <Text style={styles.label}>Inspect or transfer saved tuning. Nothing here restarts the model. Preset changes share the Load and Stop queue; a change can delay Stop while up to four CLI calls finish (up to 60 seconds each).</Text>
      {isLoading ? <Text style={text}>Reading presets…</Text> : null}
      {!isLoading && status && !status.presets.length ? <Text style={text}>No saved presets. Run Autotune or import a matching preset below.</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(status?.presets ?? []).map((p) => <View key={p.id}>{button(`${p.id === preset ? "Selected: " : "Inspect: "}${p.name}`, () => setPreset(p.id), pending)}</View>)}
      </View>
      {selected ? <View style={{ gap: 8 }}>
        <Text style={text}>Preset name</Text>
        <TextInput accessibilityLabel="Preset name" value={name} onChangeText={setName} maxLength={80} editable={!pending} style={input} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {button(renameAction.isPending ? "Renaming…" : "Rename preset", () => renameAction.mutate(), pending || !presetName.safeParse(name).success || name.trim() === selected.name)}
          {button(exportAction.isPending ? "Preparing JSON…" : "Export JSON", () => exportAction.mutate(), pending)}
        </View>
        {details.isLoading ? <Text style={text}>Reading full details…</Text> : null}
        {detail ? <>
          <Text selectable style={text}>{JSON.stringify(summary, null, 2)}</Text>
          {button(evidence ? "Hide trial evidence" : "Show trial evidence", () => setEvidence(!evidence))}
          {evidence ? <Text selectable style={text}>{JSON.stringify(trials ?? {}, null, 2)}</Text> : null}
        </> : null}
      </View> : null}
      {exported ? <View style={{ gap: 4 }}>
        <Text style={text}>Exported JSON · select and copy, then save locally</Text>
        <TextInput accessibilityLabel="Exported preset JSON" multiline editable={false} selectTextOnFocus value={exported} style={[input, { minHeight: 160, maxHeight: 320 }]} />
      </View> : null}
      <Text style={text}>Import preset JSON</Text>
      <Text style={styles.label}>Matching model choices only, up to 512 KiB, names up to 80 characters. Unsupported settings and malformed metadata are rejected. Import saves an inactive copy and clears foreign recheck claims; it never applies it.</Text>
      <TextInput accessibilityLabel="Paste preset JSON to import" placeholder="Paste a Strata preset export" placeholderTextColor={c.foregroundMuted} multiline value={pasted} onChangeText={setPasted} maxLength={PRESET_JSON_LIMIT} editable={!pending} style={[input, { minHeight: 160, maxHeight: 320 }]} />
      {button(importAction.isPending ? "Importing…" : "Import as inactive preset", () => importAction.mutate(), pending || !pasted.trim())}
      <Text style={text}>Effective tuning at next start</Text>
      <Text style={styles.label}>Saved tuning after pinned user_args overrides, not the live process. Automatic engine decisions can change these flags later. Only supported tuning flags and environment values are included.</Text>
      {settings.isLoading ? <Text style={text}>Reading effective tuning…</Text> : null}
      {settings.data ? <Text selectable style={text}>{settings.data.json}</Text> : null}
      {button("Refresh preset details", () => void refresh(), pending)}
      {notice ? <Text accessibilityLiveRegion="polite" style={text}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ ...text, color: c.statusDanger }}>{error.message}</Text> : null}
    </View> : null}
  </View>;
}
