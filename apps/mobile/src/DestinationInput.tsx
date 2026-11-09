import {
  DESTINATION_BY_KEY,
  REASON_LABELS,
  foldPlace,
  localSuggestions,
  mergeSuggestions,
  type BrowseDestination,
  type PastTrip,
  type PlaceSuggestion,
} from "@travel/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, TextInput, View, type HostInstance, type TextStyle } from "react-native";
import { api } from "./api";
import { useAuth } from "./auth";
import { FONT, useTheme } from "./theme";
import { Text, useRevealOnScreen } from "./ui";

const asSuggestion = (d: { key: string; name: string; country: string; kind: "city" | "region" }, reason: PlaceSuggestion["reason"]): PlaceSuggestion => ({
  label: d.kind === "region" ? d.name : `${d.name}, ${d.country}`,
  name: d.name,
  sub: d.kind === "region" ? `Several stops · ${d.country}` : d.country,
  kind: d.kind === "region" ? "region" : "city",
  reason,
  key: d.key,
});

/**
 * The destination box, guessing where you want to go as you type: Pylos places, your For you
 * picks and places you've been come up instantly, then cities, regions and countries from the
 * map. Before you type, it suggests your picks and what's trending.
 */
export function DestinationInput({
  value,
  mode,
  placeholder,
  style,
  onChange,
  onPick,
}: {
  value: string;
  mode: "single" | "multi";
  placeholder: string;
  style: TextStyle;
  onChange: (text: string) => void;
  onPick: (s: PlaceSuggestion) => void;
}) {
  const t = useTheme();
  const { session } = useAuth();
  const [focused, setFocused] = useState(false);
  // The label just chosen: the list stays closed until something new is typed.
  const [picked, setPicked] = useState<string | null>(null);
  const [forYou, setForYou] = useState<string[]>([]);
  const [been, setBeen] = useState<{ city: string; countryCode: string }[]>([]);
  const [trending, setTrending] = useState<BrowseDestination[]>([]);
  const [remote, setRemote] = useState<{ q: string; list: PlaceSuggestion[] }>({ q: "", list: [] });
  const asked = useRef(false);
  const box = useRef<HostInstance>(null);
  const reveal = useRevealOnScreen();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  // What to guess from, fetched the first time the box is used.
  const userId = session?.user.id;
  useEffect(() => {
    if (!focused || asked.current || !userId) return;
    asked.current = true;
    api<{ picks: { key: string }[]; member: boolean }>("/api/browse/foryou")
      .then((r) => r.member && setForYou(r.picks.map((p) => p.key)))
      .catch(() => {});
    api<{ places: PastTrip[] }>("/api/community/places")
      .then((r) => setBeen(r.places.map((p) => ({ city: p.city, countryCode: p.countryCode }))))
      .catch(() => {});
    api<{ destinations: BrowseDestination[] }>("/api/browse")
      .then((r) => setTrending(r.destinations.slice(0, 5)))
      .catch(() => {});
  }, [focused, userId]);

  // The map's suggestions, a moment after typing stops.
  const q = value.trim();
  useEffect(() => {
    if (foldPlace(q).length < 2 || q === picked) return;
    let alive = true;
    const timer = setTimeout(() => {
      api<{ suggestions: PlaceSuggestion[] }>(`/api/places/suggest?q=${encodeURIComponent(q)}`)
        .then((r) => alive && setRemote({ q, list: r.suggestions }))
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, picked]);

  const list = useMemo(() => {
    if (!q) {
      const picks = forYou.map((k) => DESTINATION_BY_KEY[k]).filter((d): d is NonNullable<typeof d> => !!d).slice(0, 3);
      const trend = trending.filter((d) => !forYou.includes(d.key)).slice(0, picks.length ? 3 : 5);
      return [...picks.map((d) => asSuggestion(d, "for-you")), ...trend.map((d) => asSuggestion(d, "featured"))];
    }
    const local = localSuggestions(q, { mode, forYou, been, max: 6 });
    // Map results for older letters stay until the new ones arrive, filtered to what's typed now.
    const fresh = remote.list.filter((s) => foldPlace(s.label).includes(foldPlace(q).split(" ")[0] ?? ""));
    return mergeSuggestions(local, fresh, 6);
  }, [q, mode, forYou, been, trending, remote]);

  const open = focused && picked !== value && list.length > 0;

  function choose(s: PlaceSuggestion) {
    setPicked(s.label);
    onPick(s);
    Keyboard.dismiss();
  }

  return (
    <View ref={box} style={{ gap: 6 }}>
      <TextInput
        style={style}
        value={value}
        onChangeText={(v) => {
          setPicked(null);
          onChange(v);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setFocused(true);
          // Up to the top of the screen, so the suggestions show above the keyboard.
          reveal?.(box.current);
        }}
        // On the web a tap on a suggestion takes the focus first: let the tap land before closing.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setFocused(false), Platform.OS === "web" ? 200 : 0);
        }}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="done"
        accessibilityLabel="Destination"
      />
      {open ? (
        <View accessibilityRole="list" style={{ borderWidth: 1, borderColor: t.line, borderRadius: 16, backgroundColor: t.surface, overflow: "hidden" }}>
          {!q ? (
            <Text style={{ color: t.muted, fontFamily: FONT.display, fontSize: 11.5, letterSpacing: 1.6, textTransform: "uppercase", paddingHorizontal: 14, paddingTop: 10 }}>
              {forYou.length ? "Picked for you, and trending" : "Trending now"}
            </Text>
          ) : null}
          {list.map((s, i) => (
            <Pressable
              key={`${s.label}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${s.name}, ${s.sub}${s.reason ? `, ${REASON_LABELS[s.reason]}` : ""}`}
              onPress={() => choose(s)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 9,
                paddingHorizontal: 14,
                borderTopWidth: i || !q ? 1 : 0,
                borderTopColor: t.line,
                backgroundColor: pressed ? t.sunk : "transparent",
              })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 17, fontWeight: "600" }} numberOfLines={1}>
                  {s.name}
                </Text>
                {s.sub ? (
                  <Text style={{ color: t.muted, fontSize: 14 }} numberOfLines={1}>
                    {s.sub}
                  </Text>
                ) : null}
              </View>
              {s.reason && s.reason !== "featured" ? (
                <Text style={{ color: s.reason === "for-you" ? t.accent : t.muted, fontSize: 12.5, fontWeight: "700" }}>{REASON_LABELS[s.reason]}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
