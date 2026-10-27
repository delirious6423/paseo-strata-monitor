import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import type { BenchOptions, TuneOptions } from "../shared/options";

export function OptionSection({ title, theme, children }: { title: string; theme: PluginTheme; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ minHeight: 48, justifyContent: "center" }}>
      <Text style={{ color: theme.colors.accent, fontSize: 14 }}>{open ? "Hide" : "Show"} {title}</Text>
    </Pressable>
    {open ? children : null}
  </View>;
}
export function Field({ label, value, onChange, theme, disabled, numeric = false, multiline = false }: {
  label: string; value: string; onChange: (s: string) => void; theme: PluginTheme; disabled: boolean; numeric?: boolean; multiline?: boolean;
}) {
  const c = theme.colors;
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (numeric) setDraft(current => value === "NaN" || Number(current) === Number(value) ? current : value);
  }, [value, numeric]);
  return <View style={{ gap: 4 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
    <TextInput accessibilityLabel={label} value={numeric ? draft : value} onChangeText={v => { setDraft(v); onChange(v); }} editable={!disabled}
      keyboardType={numeric ? "numeric" : "default"} autoCapitalize="none" autoCorrect={false} multiline={multiline}
      style={{ color: c.foreground, backgroundColor: c.surface2, borderColor: c.border, borderWidth: 1, borderRadius: 8,
        padding: 12, fontSize: 16, minHeight: multiline ? 96 : 48, opacity: disabled ? 0.45 : 1 }} />
  </View>;
}
export function Toggle({ label, value, onChange, theme, disabled }: {
  label: string; value: boolean; onChange: (b: boolean) => void; theme: PluginTheme; disabled: boolean;
}) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}>
    <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} />
    <Text style={{ color: theme.colors.foreground, fontSize: 14, flexShrink: 1 }}>{label}</Text>
  </View>;
}
export function Choices<T extends string>({ label, value, values, onChange, theme, disabled }: {
  label: string; value: T; values: readonly T[]; onChange: (s: T) => void; theme: PluginTheme; disabled: boolean;
}) {
  const c = theme.colors;
  return <View style={{ gap: 4 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {values.map((v) => <Pressable key={v} accessibilityRole="radio" accessibilityLabel={`${label}: ${v}`}
        accessibilityState={{ checked: value === v, disabled }} disabled={disabled} onPress={() => onChange(v)}
        style={{ minHeight: 48, maxWidth: "100%", justifyContent: "center", borderColor: v === value ? c.accent : c.border, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
          backgroundColor: v === value ? c.surface2 : "transparent", opacity: disabled ? 0.45 : 1 }}>
        <Text style={{ color: c.foreground, fontSize: 14 }}>{v}</Text></Pressable>)}
    </View>
  </View>;
}
export function TuneSettings({ value: o, onChange, theme, disabled }: {
  value: TuneOptions; onChange: (v: TuneOptions) => void; theme: PluginTheme; disabled: boolean;
}) {
  const common = { theme, disabled };
  const set = <K extends keyof TuneOptions>(key: K, v: TuneOptions[K]) => onChange({ ...o, [key]: v });
  return <OptionSection title="tuning options" theme={theme}>
    <Choices {...common} label="Tuning workload" value={o.use} values={["chat", "coding"]} onChange={(v) => set("use", v)} />
    <Choices {...common} label="Tuning objective" value={o.goal} values={["speed", "room", "reserve"]} onChange={(v) => set("goal", v)} />
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Speed maximizes performance. Room leaves memory free; reserve specifies a graphics memory budget. Saved room tuning requires Model configuration → Resource profile = work; saved speed tuning requires full. A RAM reserve also selects room. A mismatch with the selected model is shown below and blocks Autotune; measurement only can use either.</Text>
    {o.goal === "reserve" ? <Field {...common} numeric label="Graphics memory to leave free (MiB)" value={String(o.reserveMiB)} onChange={(v) => set("reserveMiB", Number(v))} /> : null}
    <Field {...common} numeric label="System RAM to leave free (0–50%)" value={String(o.leaveRam)} onChange={(v) => set("leaveRam", Number(v))} />
    <Toggle {...common} label="Allow small answer differences" value={o.allowSmallDifferences} onChange={(v) => set("allowSmallDifferences", v)} />
    <Toggle {...common} label="Allow answers that differ between identical runs" value={o.allowNotRepeatable} onChange={(v) => set("allowNotRepeatable", v)} />
    {o.allowSmallDifferences || o.allowNotRepeatable ? <Text style={{ color: theme.colors.statusWarning, fontSize: 14 }}>These permissions broaden the search but can change generated answers. They are not a guarantee of better speed.</Text> : null}
    <Field {...common} numeric label="Time budget in minutes (blank uses mode default)" value={o.minutes === null ? "" : String(o.minutes)} onChange={(v) => set("minutes", v.trim() ? Number(v) : null)} />
    <Field {...common} label="Preset name (blank generates a name)" value={o.name} onChange={(v) => set("name", v)} />
    <Toggle {...common} label="Save the resulting preset" value={o.save} onChange={(v) => set("save", v)} />
    <Toggle {...common} label="Wait for other workloads to become idle" value={o.quietCheck} onChange={(v) => set("quietCheck", v)} />
    {!o.quietCheck ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>Disabling the quiet check can produce misleading results under competing CPU/GPU load.</Text> : null}
    <Field {...common} numeric label="Engine boot timeout (seconds)" value={String(o.bootTimeout)} onChange={(v) => set("bootTimeout", Number(v))} />
  </OptionSection>;
}
export function BenchSettings({ value: o, onChange, theme, disabled }: {
  value: BenchOptions; onChange: (v: BenchOptions) => void; theme: PluginTheme; disabled: boolean;
}) {
  const common = { theme, disabled };
  const set = <K extends keyof BenchOptions>(key: K, v: BenchOptions[K]) => onChange({ ...o, [key]: v });
  const standard = o.suite === "standard-v1";
  return <OptionSection title="benchmark options" theme={theme}>
    <Choices {...common} label="Benchmark suite" value={o.suite} values={["serving-smoke", "standard-v1", "parallel-mixed-v1", "parallel-overload-v1", "parallel-cancel-v1", "parallel-prefill-cancel-v1"]} onChange={(v) => set("suite", v)} />
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Strata fixes prompts, prompt lengths and output token counts within each suite. It has no custom prompt/token CLI options. Standard is a long protocol; overload and cancellation suites deliberately stress queues or cancel requests.</Text>
    {!standard ? <>
      <Field {...common} numeric label={`Concurrent requests (1–${o.suite === "parallel-overload-v1" ? 64 : 16})`} value={String(o.concurrency)} onChange={(v) => set("concurrency", Number(v))} />
      <Field {...common} numeric label="Measured repeats (1–5)" value={String(o.repeat)} onChange={(v) => set("repeat", Number(v))} />
      <Field {...common} label="Run condition label" value={o.condition} onChange={(v) => set("condition", v)} />
      <Field {...common} numeric label="Request timeout (1–600 seconds)" value={String(o.requestTimeout)} onChange={(v) => set("requestTimeout", Number(v))} />
      <Field {...common} label="Telemetry credential environment variable (optional)" value={o.telemetryCredentialEnv} onChange={(v) => set("telemetryCredentialEnv", v)} />
    </> : <>
      <Toggle {...common} label="Include optional concurrent stage" value={o.optionalConcurrency} onChange={(v) => set("optionalConcurrency", v)} />
      <Choices {...common} label="Protocol track" value={o.track} values={["default", "custom"]} onChange={(v) => set("track", v)} />
      {([ ["trackNotes", "Track notes"], ["modelRevision", "Quantized model revision"], ["sourceRevision", "Original weights revision"],
        ["tokenizerRevision", "Tokenizer revision"], ["quantization", "Quantization name"], ["customPack", "Custom pack description"], ["buildOptions", "Build options (comma separated)"] ] as const).map(([key, label]) =>
        <Field key={key} {...common} label={label} value={o[key]} onChange={(v) => set(key, v)} />)}
      <Field {...common} multiline label="Background programs (one per line)" value={o.background.join("\n")} onChange={(v) => set("background", v.split("\n"))} />
      <Toggle {...common} label="Skip model hash (marks protocol nonconforming)" value={o.skipModelHash} onChange={(v) => set("skipModelHash", v)} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Runs against the loaded server only; it will not start a different profile. Standard protocol fixes repeats, concurrency and the 1800 second request timeout.</Text>
    </>}
    <Field {...common} label="API credential environment variable (STRATA_ name only, never paste a key)" value={o.credentialEnv} onChange={(v) => set("credentialEnv", v)} />
  </OptionSection>;
}
