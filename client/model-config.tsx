import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { type Engine, strataEngines } from "../shared/control";
import { MAX_CONFIG_BYTES, fieldValue, modelConfigFields, parseFieldValue, setFieldValue, strataModelConfig, strataSaveModelConfig, type ConfigField, type ModelConfigDocument } from "../shared/model-config";
import type { Styles } from "./monitor";

type Props = { theme: PluginTheme; styles: Styles; sel: Engine; busy: boolean };
export function ModelConfig(props: Props) {
  // Switching models must never carry the previous model's draft or revision into the next save.
  return <ConfigEditor key={props.sel.id} {...props} />;
}
function ConfigEditor({ theme, styles, sel, busy }: Props) {
  const c = theme.colors;
  const read = useRpc(strataModelConfig);
  const save = useRpc(strataSaveModelConfig);
  const rescan = useRpc(strataEngines);
  const client = useQueryClient();
  const key = ["strata-model-config", sel.id];
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [group, setGroup] = useState<string | null>("Context and memory");
  const [json, setJson] = useState<string | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pruneBackups, setPruneBackups] = useState(false);
  const query = useQuery({ queryKey: key, queryFn: () => read({ id: sel.id }), enabled: open, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const source = json ?? query.data?.json ?? "";
  const digest = revision ?? query.data?.digest;
  let config: ModelConfigDocument | null = null;
  let error: string | null = null;
  try {
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { throw new Error("Enter a valid JSON object before saving"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Configuration must be a JSON object");
    config = parsed as ModelConfigDocument;
    for (const field of modelConfigFields) {
      if (Object.hasOwn(drafts, field.key)) config = setFieldValue(config, field, parseFieldValue(field, drafts[field.key]!));
    }
  } catch (e) {
    // Native JSON parse errors can echo credential text the user just pasted.
    error = e instanceof Error ? e.message : "Enter a valid JSON object before saving";
  }
  const effective = config ? JSON.stringify(config, null, 2) + "\n" : source;
  const dirty = json !== null || Object.keys(drafts).length > 0 || pruneBackups;
  const stopped = sel.state === "stopped" || sel.state === "failed";
  const action = useMutation({
    mutationFn: () => {
      if (!digest || !config || error) throw new Error("Load a valid configuration before saving");
      return save({ id: sel.id, digest, json: effective, pruneBackups });
    },
    onSuccess: (result) => {
      client.setQueryData(key, result);
      setJson(null); setRevision(null); setDrafts({}); setPruneBackups(false);
      setMessage(`Saved. Previous version: ${result.backup}. ${result.note}`);
      void rescan({ rescan: true }).then(data => client.setQueryData(["strata-engines"], data)).catch(() => {
        setMessage(previous => `${previous} Discovery refresh failed; search again before loading.`);
      });
    },
  });
  const disabled = busy || !stopped || action.isPending;
  const button = (label: string, onPress: () => void, off = false, selected = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off, selected }} disabled={off} onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8, borderColor: selected ? c.accent : c.border, backgroundColor: pressed ? c.surface2 : "transparent", opacity: off ? 0.45 : 1 })}>
      <Text style={{ color: selected ? c.accent : c.foreground, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const fieldStyle = { color: c.foreground, backgroundColor: c.surface2, borderColor: c.border, borderWidth: 1, borderRadius: 8, padding: 8, fontSize: 14, minHeight: 40 };
  const changed = (field: ConfigField, text: string) => {
    setJson(old => old ?? source); setRevision(old => old ?? digest ?? null);
    setDrafts(old => ({ ...old, [field.key]: text })); setMessage(""); action.reset();
  };
  const editor = (field: ConfigField) => {
    const value = config ? fieldValue(config, field) : undefined;
    const text = drafts[field.key] ?? (value === undefined ? "" : field.kind === "json" ? JSON.stringify(value, null, 2) : String(value));
    return (
      <View key={field.key} style={{ gap: 8 }}>
        <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>{field.label}</Text>
        <Text style={styles.label}>{field.help}</Text>
        {field.kind === "boolean" || field.kind === "choice" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {button("Default", () => changed(field, ""), disabled || !config, value === undefined)}
            {(field.kind === "boolean" ? ["true", "false"] : field.choices ?? []).map(choice => (
              <View key={choice}>{button(field.kind === "boolean" ? choice === "true" ? "On" : "Off" : choice,
                () => changed(field, choice), disabled || !config, String(value) === choice)}</View>
            ))}
          </View>
        ) : (
          <TextInput accessibilityLabel={field.label} value={text} onChangeText={text => changed(field, text)} editable={!disabled && !!config}
            multiline={field.kind === "json"} autoCapitalize="none" autoCorrect={false} placeholder="Default (not set)" placeholderTextColor={c.foregroundMuted}
            style={[fieldStyle, field.kind === "json" ? { minHeight: 96, textAlignVertical: "top" } : {}]} />
        )}
      </View>
    );
  };
  const reload = async () => {
    const next = await query.refetch();
    if (next.data && !next.error) { setJson(null); setRevision(null); setDrafts({}); setPruneBackups(false); setMessage("Reloaded from disk. Unsaved changes discarded."); action.reset(); }
  };
  return (
    <View style={{ gap: 12 }}>
      {button(open ? "Hide model configuration" : "Model configuration", () => setOpen(!open), action.isPending, open)}
      {open ? <>
        <Text style={styles.label}>Edit launch settings for {sel.name}. Save while all models and tools are stopped, then load manually. Saving never restarts a model.</Text>
        {!query.data ? <Text style={styles.label} accessibilityLiveRegion="polite">{query.error ? `Configuration unavailable: ${query.error.message}` : "Reading configuration…"}</Text> : <>
          {!stopped || busy ? <Text style={{ color: c.statusWarning, fontSize: 14 }}>Read only while a model or tool is active. Stop all models and tools before saving.</Text> : null}
          <Text style={styles.label}>Blank or Default removes a setting. Availability depends on this engine build and model family. Guided changes replace conflicting arguments only for that setting. Context, cache and draft flag edits are explicit user overrides and can pin saved tuning; clear them before autotuning. Full JSON includes every setting, argument and extension; it can also change executable paths and load hooks. Credential files must be edited locally. The newest 10 Paseo backups stay beside this config; older Paseo backups move to its archive directory and are never deleted unless you explicitly select deletion below. Other backups stay untouched.</Text>
          {[...new Set(modelConfigFields.map(f => f.group))].map(name => (
            <View key={name} style={{ gap: 16 }}>
              {button(`${group === name ? "Hide" : "Show"} ${name.toLowerCase()}`, () => setGroup(group === name ? null : name), action.isPending, group === name)}
              {group === name ? modelConfigFields.filter(f => f.group === name).map(editor) : null}
            </View>
          ))}
          {button(advanced ? "Hide full configuration JSON" : "Advanced: full configuration JSON", () => setAdvanced(!advanced), action.isPending, advanced)}
          {advanced ? <>
            <Text style={styles.label}>Complete file, not a subset. Unknown keys are preserved unless you deliberately remove them here. Limit: 256 KiB; credentials and nonlocal listen addresses are rejected. No automatic schema migration or engine compatibility guarantee.</Text>
            <TextInput accessibilityLabel="Full model configuration JSON" multiline value={effective} onChangeText={text => {
              setJson(text); setRevision(digest ?? null); setDrafts({}); setMessage(""); action.reset();
            }} editable={!disabled} maxLength={MAX_CONFIG_BYTES} autoCapitalize="none" autoCorrect={false}
              style={[fieldStyle, { minHeight: 320, textAlignVertical: "top" }]} />
          </> : null}
          <Pressable accessibilityRole="checkbox" accessibilityLabel="Delete older plugin backups after saving (keep newest10)" accessibilityState={{ checked: pruneBackups, disabled }} disabled={disabled}
            onPress={() => { setPruneBackups(value => !value); action.reset(); }}
            style={({ pressed }) => ({ padding: 12, borderWidth: 1, borderRadius: 8, borderColor: pruneBackups ? c.statusWarning : c.border, backgroundColor: pressed ? c.surface2 : "transparent", opacity: disabled ? 0.45 : 1 })}>
            <Text style={{ color: c.foreground, fontSize: 14 }}>{pruneBackups ? "☑" : "☐"} Delete older plugin backups after saving (keep newest10)</Text>
          </Pressable>
          <Text style={{ color: pruneBackups ? c.statusWarning : c.foregroundMuted, fontSize: 14 }}>Optional and irreversible: permanently delete older plugin backups from this config directory and its archive, keeping the newest 10 total. Legacy backups and other files stay untouched. Off by default; consent resets after a successful save or reload.</Text>
          {dirty && error ? <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 14 }}>{error}</Text> : null}
          {action.error ? <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 14 }}>{action.error.message}</Text> : null}
          {message ? <Text accessibilityLiveRegion="polite" style={styles.label}>{message}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {button(action.isPending ? "Saving configuration…" : "Save configuration", () => action.mutate(), disabled || !dirty || !!error || !digest)}
            {button(query.isFetching ? "Reloading…" : dirty ? "Discard draft and reload" : "Reload from disk", () => void reload(), action.isPending || query.isFetching)}
          </View>
        </>}
      </> : null}
    </View>
  );
}
