import { DEMO_CITY, DEMO_TRAVELERS, HOW_PYLOS_LEARNS } from "@travel/core";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { FONT, useTheme } from "./theme";
import { Button, Eyebrow, H2, Text } from "./ui";

/** Where the person is with Pylos: no account, learning their taste, or already known. */
export type MadeForYouState = "out" | "learning" | "known";

/**
 * Browse's case for Pylos, as on the site's home page: other apps give everyone the same list,
 * Pylos plans from what you've already loved. The same Saturday in Lisbon for three example
 * travelers, each stop with why it was picked for them.
 */
export function MadeForYouCard({ state, onStart }: { state: MadeForYouState; onStart: () => void }) {
  const t = useTheme();
  const [on, setOn] = useState(0);
  const who = DEMO_TRAVELERS[on]!;
  return (
    <View style={{ backgroundColor: t.hero, borderRadius: 24, padding: 18, paddingTop: 24, gap: 18 }}>
      <View style={{ gap: 8 }}>
        <Eyebrow>Not another top-ten list</Eyebrow>
        <H2>One city, one Saturday, three different trips</H2>
        <Text style={{ color: t.heroSoft, fontSize: 17, lineHeight: 24, fontStyle: "italic" }}>
          Most travel apps hand everyone the same list. Pylos learns from the trips you&apos;ve already taken and what you loved on them, then predicts the hotel, the tables and
          the pace you&apos;ll love somewhere new.
        </Text>
      </View>

      <View style={{ backgroundColor: t.surface, borderRadius: 20, padding: 6 }}>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 4, backgroundColor: t.sunk, borderRadius: 15, padding: 4 }}>
          {DEMO_TRAVELERS.map((x, i) => (
            <Pressable
              key={x.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === on }}
              accessibilityLabel={`${x.name}: ${x.tag}`}
              onPress={() => setOn(i)}
              style={{ flex: 1, borderRadius: 11, paddingVertical: 9, paddingHorizontal: 6, backgroundColor: i === on ? t.surface : "transparent", alignItems: "center" }}
            >
              <Text numberOfLines={1} style={{ color: i === on ? t.ink : t.muted, fontFamily: FONT.display, fontSize: 15.5 }}>
                {x.name}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ padding: 12, paddingTop: 14, gap: 10 }}>
          <Text style={{ color: t.muted, fontFamily: FONT.display, fontSize: 11.5, letterSpacing: 1.6, textTransform: "uppercase" }}>
            Saturday in {DEMO_CITY}, for {who.name}
          </Text>
          <Text style={{ color: t.muted, fontSize: 15.5, lineHeight: 21 }}>
            <Text style={{ color: t.ink, fontWeight: "700" }}>{who.tag}. </Text>
            {who.learned}
          </Text>
          {who.stops.map((s, i) => (
            <View key={s.name} style={{ flexDirection: "row", gap: 10, paddingTop: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
              <Text
                style={{
                  width: 44,
                  color: s.time === "Stay" ? t.accent : t.muted,
                  fontFamily: FONT.display,
                  fontSize: s.time === "Stay" ? 11 : 14,
                  letterSpacing: s.time === "Stay" ? 1.6 : 0.4,
                  textTransform: "uppercase",
                  paddingTop: s.time === "Stay" ? 3 : 1,
                }}
              >
                {s.time}
              </Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: t.ink, fontSize: 16.5, fontWeight: "700", lineHeight: 21 }}>{s.name}</Text>
                <Text style={{ color: t.muted, fontSize: 15, lineHeight: 20 }}>
                  <Text style={{ color: t.ink, fontFamily: FONT.display, fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase" }}>{who.forLabel} · </Text>
                  {s.why}
                </Text>
              </View>
            </View>
          ))}
          <Text style={{ color: t.muted, fontSize: 13.5 }}>Example travelers. Your plan comes from your own trips.</Text>
        </View>
      </View>

      <View style={{ gap: 12 }}>
        {HOW_PYLOS_LEARNS.map((s, i) => (
          <View key={s.title} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.surface, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: t.ink, fontFamily: FONT.display, fontSize: 14 }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ color: t.heroInk, fontFamily: FONT.display, fontSize: 17 }}>{s.title}</Text>
              <Text style={{ color: t.heroSoft, fontSize: 15, lineHeight: 20 }}>{s.text}</Text>
            </View>
          </View>
        ))}
      </View>
      <Button title={state === "out" ? "Start with a past trip" : state === "learning" ? "Teach Pylos your taste" : "See your taste profile"} onPress={onStart} />
    </View>
  );
}
