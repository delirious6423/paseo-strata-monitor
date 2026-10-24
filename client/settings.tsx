import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { discoverySettings } from "../shared/control";
import { useEngines } from "./control";

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function DiscoverySettings({ theme }: PluginSurfaceProps) {
  const c = theme.colors;
  const settings = useSettings(discoverySettings);
  const { data } = useEngines();
  const [folders, setFolders] = useState("");
  const [urls, setUrls] = useState("");
  const ready = settings.status === "ready";
  const revision = ready ? settings.revision : null;
  useEffect(() => {
    if (settings.status !== "ready") return;
    setFolders(settings.values.extraFolders.join("\n"));
    setUrls(settings.values.extraUrls.join("\n"));
  }, [revision]);

  const field = { color: c.foreground, borderColor: c.border, borderWidth: 1, borderRadius: 8, padding: 8, minHeight: 64, fontSize: 13 };
  const muted = { color: c.foregroundMuted, fontSize: 12 };
  const badFolder = lines(folders).find((f) => !(f.startsWith("/") || /^[A-Za-z]:[\\/]/.test(f) || f.startsWith("\\\\")));
  const badUrl = lines(urls).find((u) => !/^https?:\/\/[^\s/@]+/.test(u));

  if (!ready) return <Text style={muted}>{settings.status === "loading" ? "Loading…" : `Settings error: ${"error" in settings ? settings.error : ""}`}</Text>;
  const save = () =>
    settings.save({ ...settings.values, extraFolders: lines(folders), extraUrls: lines(urls) }, settings.revision);

  return (
    <>
      <SettingsSection title="Where to look for models">
        <SettingsCard>
          <SettingsRow
            label="Extra model folders"
            hint="Folders with Strata run configs (JSON) that no Strata install lists. One absolute path per line."
            error={badFolder ? `Not an absolute path: ${badFolder}` : undefined}
          >
            <TextInput multiline value={folders} onChangeText={setFolders} style={field} autoCapitalize="none" autoCorrect={false}
              placeholderTextColor={c.foregroundMuted} />
          </SettingsRow>
          <SettingsRow
            label="Extra Strata servers"
            hint="Servers the scan can't see, e.g. on another machine. One http(s) root URL per line."
            error={badUrl ? `Not an http(s) URL: ${badUrl}` : undefined}
          >
            <TextInput multiline value={urls} onChangeText={setUrls} style={field} autoCapitalize="none" autoCorrect={false}
              placeholderTextColor={c.foregroundMuted} />
          </SettingsRow>
          <SettingsAction
            label={settings.saveError ? `Not saved: ${settings.saveError}` : "Save changes"}
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={settings.saving || !!badFolder || !!badUrl}
            onPress={() => void save()}
          />
          <SettingsSwitch
            label="Use existing systemd user services (Linux)"
            hint="Start and stop a model through the user service that already runs it, so desktop shortcuts and Paseo agree."
            value={settings.values.useSystemd}
            onValueChange={(useSystemd) => void settings.save({ ...settings.values, useSystemd }, settings.revision)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Free the GPU">
        <SettingsCard>
          <SettingsRow
            label="Stop a model after no requests for"
            hint="Checked every 30 s from the server's own request counters. Off by default; a running tool (Autotune, Benchmark) is never interrupted."
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {[0, 15, 30, 60, 120].map((m) => {
                const on = settings.values.idleStopMinutes === m;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={m ? `Stop after ${m} minutes idle` : "Never stop when idle"}
                    disabled={settings.saving}
                    onPress={() => void settings.save({ ...settings.values, idleStopMinutes: m }, settings.revision)}
                    style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1,
                      borderColor: on ? c.accent : c.border, backgroundColor: on ? c.surface2 : "transparent" }}
                  >
                    <Text style={{ color: c.foreground, fontSize: 13 }}>{m ? `${m} min` : "Off"}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Searched">
        <SettingsCard>
          {(data?.places ?? []).map((p) => (
            <SettingsRow key={p.source + p.path} label={p.source} hint={`${p.path}${p.note ? ` (${p.note})` : ""}`}>
              <Text style={muted}>{p.models} {p.models === 1 ? "model" : "models"}</Text>
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
