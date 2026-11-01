import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./theme";

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 22, padding: 20, gap: 18 }, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontSize: 34, fontWeight: "800", letterSpacing: -1, lineHeight: 36 }}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.6, lineHeight: 28 }}>{children}</Text>;
}
export function P({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[{ color: muted ? t.muted : t.ink, fontSize: 16, lineHeight: 23 }, style]}>{children}</Text>;
}
export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontSize: 15, fontWeight: "700" }}>{children}</Text>;
}

export function Button({ title, onPress, disabled, ghost, danger }: { title: string; onPress: () => void; disabled?: boolean; ghost?: boolean; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: ghost ? t.surface : t.accent,
        borderColor: danger ? t.bad : t.line,
        borderWidth: ghost ? 1 : 0,
        paddingVertical: ghost ? 9 : 16,
        paddingHorizontal: 16,
        borderRadius: ghost ? 999 : 14,
        alignItems: "center",
        alignSelf: ghost ? "flex-start" : "stretch",
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: ghost ? (danger ? t.bad : t.ink) : t.accentInk, fontWeight: "700", fontSize: ghost ? 14 : 17 }}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ borderWidth: 1, borderColor: on ? t.ink : t.line, backgroundColor: on ? t.ink : t.surface, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 15 }}
    >
      <Text style={{ color: on ? t.bg : t.ink, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  labels,
  single,
}: {
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  labels?: Partial<Record<T, string>>;
  single?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <Chip
            key={o}
            label={labels?.[o] ?? o}
            on={on}
            onPress={() => onChange(single ? [o] : on ? value.filter((v) => v !== o) : [...value, o])}
          />
        );
      })}
    </View>
  );
}

export function Status({ text, err }: { text?: string | null; err?: boolean }) {
  const t = useTheme();
  if (!text) return null;
  return <Text style={{ color: err ? t.bad : t.muted, fontSize: 14 }}>{text}</Text>;
}

export function Loading({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
      <ActivityIndicator color={t.accent} />
      <Text style={{ color: t.muted, fontSize: 14, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  field: { gap: 8 },
});
