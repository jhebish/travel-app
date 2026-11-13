import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, View, type HostInstance, type ScrollViewInstance, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FONT, useTheme } from "./theme";

/**
 * Text in the Pylos type. Screens use this instead of React Native's Text. Custom fonts don't
 * take fontWeight reliably (iOS falls back to the system font), so the weight picks the file:
 * 800 is a heading or a big number and gets Marcellus, as on the site; 600–700 EB Garamond
 * SemiBold, 500 Medium, italic Italic, everything else Regular. An explicit fontFamily wins.
 */
export function Text({ style, ...rest }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return <RNText style={style} {...rest} />;
  const { fontWeight, fontStyle, letterSpacing, ...others } = flat;
  const w = String(fontWeight ?? "400");
  const display = w === "800" || w === "900";
  const fontFamily = display
    ? FONT.display
    : fontStyle === "italic"
      ? FONT.italic
      : w === "700" || w === "600" || w === "bold"
        ? FONT.semibold
        : w === "500"
          ? FONT.medium
          : FONT.body;
  // Tight negative tracking suited the old heavy sans; Marcellus wants a touch of air.
  const spacing = display ? Math.max(letterSpacing ?? 0, 0.2) : letterSpacing;
  return <RNText style={[others, { fontFamily, letterSpacing: spacing }]} {...rest} />;
}

type Reveal = (node: HostInstance | null) => void;
const RevealContext = createContext<Reveal | null>(null);
/**
 * Scrolls the page so a view sits at the top of the screen: the destination box does this as
 * it's typed in, so its suggestions show above the keyboard. Null outside a Screen.
 */
export const useRevealOnScreen = () => useContext(RevealContext);

/** A scrolling page. `scrollEnabled` is off while something on it takes the drag (the globe). */
export function Screen({ children, scrollEnabled = true }: { children: ReactNode; scrollEnabled?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  // A point at the top of the page's content, to measure other views from.
  const top = useRef<HostInstance>(null);
  const reveal = useCallback<Reveal>((node) => {
    const anchor = top.current;
    if (!node || !anchor) return;
    anchor.measureInWindow((_x, from) =>
      node.measureInWindow((_x2, y) => {
        if (Number.isFinite(from) && Number.isFinite(y)) scroll.current?.scrollTo({ y: Math.max(0, y - from - 8), animated: true });
      }),
    );
  }, []);
  return (
    <ScrollView
      ref={scroll}
      scrollEnabled={scrollEnabled}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <View ref={top} pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1 }} />
      <RevealContext.Provider value={reveal}>{children}</RevealContext.Provider>
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 22, padding: 20, gap: 18 }, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontSize: 32, fontWeight: "800", lineHeight: 38 }}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontSize: 23, fontWeight: "800", lineHeight: 29 }}>{children}</Text>;
}
export function P({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[{ color: muted ? t.muted : t.ink, fontSize: 17.5, lineHeight: 25 }, style]}>{children}</Text>;
}
/** Small tracked capitals, like the site's field labels. */
export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontFamily: FONT.display, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase" }}>{children}</Text>;
}

/** The site's eyebrow: small tracked capitals above a heading ("PICKED FOR YOU"). */
export function Eyebrow({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontFamily: FONT.display, fontSize: 12.5, letterSpacing: 2, textTransform: "uppercase" }}>{children}</Text>;
}

/** A small pill: "In season now" (season), a trend list (trend), or a plain fact. */
export function Badge({ text, tone = "plain" }: { text: string; tone?: "season" | "trend" | "plain" }) {
  const t = useTheme();
  const bg = tone === "season" ? t.hero : tone === "trend" ? t.lavender : t.sunk;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 11, alignSelf: "flex-start" }}>
      <Text style={{ color: t.ink, fontSize: 14, fontWeight: "500" }}>{text}</Text>
    </View>
  );
}

/** `ghost`: a small outlined button; `wide`: the same look, full width (e.g. "Continue with Google"). */
export function Button({ title, onPress, disabled, ghost, danger, wide }: { title: string; onPress: () => void; disabled?: boolean; ghost?: boolean; danger?: boolean; wide?: boolean }) {
  const t = useTheme();
  const outline = ghost || wide;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: outline ? t.surface : t.btn,
        borderColor: danger ? t.bad : t.line,
        borderWidth: outline ? 1 : 0,
        minHeight: wide ? 50 : ghost ? 40 : 54,
        justifyContent: "center",
        paddingHorizontal: outline ? 16 : 22,
        borderRadius: 999,
        alignItems: "center",
        alignSelf: ghost && !wide ? "flex-start" : "stretch",
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {outline ? (
        <Text style={{ color: danger ? t.bad : t.ink, fontWeight: "500", fontSize: 16 }}>{title}</Text>
      ) : (
        <Text style={{ color: t.btnInk, fontFamily: FONT.display, fontSize: 15, letterSpacing: 2, textTransform: "uppercase" }}>{title}</Text>
      )}
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
      <Text style={{ color: on ? t.bg : t.ink, fontSize: 16, fontWeight: "500" }}>{label}</Text>
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
  return <Text style={{ color: err ? t.bad : t.muted, fontSize: 15.5, lineHeight: 22 }}>{text}</Text>;
}

export function Loading({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
      <ActivityIndicator color={t.accent} />
      <Text style={{ color: t.muted, fontSize: 15.5, fontStyle: "italic", flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

/**
 * Progress bar for trip building. The mobile app gets one response at the end (no streaming),
 * so this estimates progress from elapsed time against a typical duration, eases toward 95%,
 * and never claims to be done before the trip arrives.
 */
export function BuildBar({ days }: { days: number }) {
  const t = useTheme();
  const [start] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const typical = 14_000 + days * 2_500; // days are planned in parallel, so this grows slowly
  const elapsed = now - start;
  const pct = Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / (typical / 1.6)))));
  const label =
    pct < 12 ? "Gathering local picks" : pct < 30 ? "Sketching the outline" : pct < 80 ? `Planning ${days === 1 ? "your day" : `all ${days} days at once`}` : "Checking every place";
  const secs = Math.floor(elapsed / 1000);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <Text style={{ color: t.ink, fontSize: 17, fontStyle: "italic", flexShrink: 1 }}>{label}</Text>
        <Text style={{ color: t.accent, fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{pct}%</Text>
      </View>
      <View style={{ height: 12, borderRadius: 999, backgroundColor: t.sunk, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
        <View style={{ width: `${pct}%`, height: "100%", borderRadius: 999, backgroundColor: t.accent }} />
      </View>
      <Text style={{ color: t.muted, fontSize: 14, fontVariant: ["tabular-nums"] }}>
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} elapsed
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  field: { gap: 8 },
});
