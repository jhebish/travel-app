import { SIGNAL_SOURCE_LABELS, countryName, stayWhen, type PastStay } from "@travel/core";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { api } from "./api";
import { useTheme } from "./theme";
import { Button, Card, Eyebrow, H2, P, Text } from "./ui";

/** "Lisbon, Portugal · May 2025 · 2 stays" */
export function stayLine(s: PastStay): string {
  const where = [s.city, s.countryCode ? countryName(s.countryCode) : null].filter(Boolean).join(", ");
  return [where, stayWhen(s), s.visits > 1 ? `${s.visits} stays` : ""].filter(Boolean).join(" · ");
}

export const staySources = (s: PastStay) => s.sources.map((x) => SIGNAL_SOURCE_LABELS[x] ?? x).join(", ");

/** Loved it (true), not for me (false) or neither (null), on every signal behind the entry. */
export async function rateStay(s: PastStay, liked: boolean | null) {
  await Promise.all(s.ids.map((id) => api(`/api/taste/signals/${id}`, { method: "PATCH", json: { liked } })));
}

/** Forget a stay: every signal behind the entry. */
export async function removeStay(s: PastStay) {
  await Promise.all(s.ids.map((id) => api(`/api/taste/signals/${id}`, { method: "DELETE" })));
}

/** Places you've stayed, on the You tab: how many, the latest few, and the whole list a tap away. */
export function StaysCard({ stays }: { stays: PastStay[] | null }) {
  const t = useTheme();
  const router = useRouter();
  if (!stays) return null;
  const named = stays.filter((s) => !s.generic);
  return (
    <Card>
      <View style={{ gap: 6 }}>
        <Eyebrow>Places you&apos;ve stayed</Eyebrow>
        <H2>{stays.length ? `${stays.length} ${stays.length === 1 ? "place" : "places"} you've stayed` : "Everywhere you've stayed, in one list"}</H2>
        <P muted style={{ fontSize: 16 }}>
          {stays.length
            ? "From your calendar, email and photos. Tell Pylos which you loved: hotel picks follow them."
            : "Scan your calendar and photos below and the hotels and rentals you've stayed in show up here. Hotel picks follow them."}
        </P>
      </View>
      {(named.length ? named : stays).slice(0, 3).map((s, i) => (
        <View key={s.ids[0]} style={{ gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, paddingTop: i ? 12 : 0 }}>
          <Text style={{ color: t.ink, fontSize: 17.5, fontWeight: "600" }}>
            {s.name}
            {s.liked === true ? <Text style={{ color: t.bad }}> ♥</Text> : null}
          </Text>
          <Text style={{ color: t.muted, fontSize: 15 }}>{stayLine(s)}</Text>
        </View>
      ))}
      {stays.length ? <Button ghost title={stays.length > 3 ? `See all ${stays.length}` : "See them all"} onPress={() => router.push("/stays")} /> : null}
    </Card>
  );
}
