import type { PluginTheme } from "@getpaseo/plugin";
import { type ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";

/** Keep drafts mounted when closing a section; hidden controls leave the accessibility tree. */
export function Section({ title, hint, theme, compact = false, children }: {
  title: string; hint?: string; theme: PluginTheme; compact?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = theme.colors;
  return <View style={{ gap: open ? (compact ? 12 : 16) : 0, minWidth: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(v => !v)}
      style={({ pressed, hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) => ({
        minHeight: compact ? 44 : 48, paddingVertical: compact ? 4 : 8, paddingHorizontal: 4, gap: 4, borderRadius: 8,
        borderWidth: 1, borderColor: focused ? c.accent : "transparent",
        backgroundColor: hovered || pressed ? c.surface2 : "transparent", opacity: pressed ? 0.7 : 1,
      })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ flex: 1, color: c.foreground, fontSize: compact ? 14 : 16, lineHeight: compact ? 20 : 24, fontWeight: "600" }}>{title}</Text>
        <Text style={{ color: c.accent, fontSize: 20 }}>{open ? "−" : "+"}</Text>
      </View>
      {hint && !open ? <Text style={{ color: c.foregroundMuted, fontSize: compact ? 12 : 14, lineHeight: compact ? 16 : 20 }}>{hint}</Text> : null}
    </Pressable>
    <View style={{ display: open ? "flex" : "none", gap: compact ? 12 : 16, minWidth: 0 }}>{children}</View>
  </View>;
}
