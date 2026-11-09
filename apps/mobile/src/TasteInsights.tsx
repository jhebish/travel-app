import { DESTINATION_BY_KEY, SIGNAL_SOURCE_LABELS, flag, tasteUnlock, type ForYouPick, type SignalSource, type TasteProfile } from "@travel/core";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { FONT, useTheme } from "./theme";
import { Card, Eyebrow, H2, Label, Loading, P, Text } from "./ui";

/** GET /api/taste */
export interface TasteResponse {
  profile: TasteProfile | null;
  stale: boolean;
  /** How they travel, counted from their trips ("24 trips since 2020, about 4 a year."). */
  habits?: string[];
  counts: { total: number; bySource: Record<SignalSource, number>; pastTrips: number; thumbs: number };
}

/** GET /api/browse/foryou */
export interface ForYou {
  picks: ForYouPick[];
  placesLogged: number;
  needMore: boolean;
  member: boolean;
  signedIn: boolean;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{title}</Label>
      {children}
    </View>
  );
}

function Lines({ lines }: { lines: string[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {lines.map((l) => (
        <View key={l} style={{ flexDirection: "row", gap: 8 }}>
          <Text style={{ color: t.accent, fontSize: 17, lineHeight: 24 }}>•</Text>
          <Text style={{ color: t.ink, fontSize: 17, lineHeight: 24, flex: 1 }}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * What Pylos has learned about how you travel and what you like, as on the site's taste card:
 * the habits counted from your trips, your travel style, where you stay and eat, and the trips
 * you'd probably love next (with destinations to open). Right after a scan (`fresh`), it says so
 * and shows the update arriving.
 */
export function TasteInsights({ data, updating, fresh, forYou }: { data: TasteResponse | null; updating: boolean; fresh?: "photos" | "calendar" | null; forYou?: ForYou | null }) {
  const t = useTheme();
  const router = useRouter();
  const unlock = tasteUnlock(data?.counts.pastTrips ?? 0);
  const eyebrow = fresh === "photos" ? "What your photos told us" : fresh === "calendar" ? "What your calendar told us" : "Your taste";

  if (!data) return updating ? <Card><Loading text="Reading your trips…" /></Card> : null;
  if (!unlock.unlocked) {
    return (
      <Card>
        <View style={{ gap: 6 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <H2>
            Log {unlock.need} trips to unlock your taste profile · {unlock.have} of {unlock.need}
          </H2>
          <P muted style={{ fontSize: 16 }}>
            Scan your photos or calendar below. Pylos then predicts the hotels and restaurants you&apos;ll love, and marks them &quot;For you&quot; in your plans.
          </P>
        </View>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: t.sunk, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: unlock.need, now: unlock.have }}>
          <View style={{ width: `${Math.max(4, Math.round((unlock.have / unlock.need) * 100))}%`, height: "100%", backgroundColor: t.accent }} />
        </View>
      </Card>
    );
  }

  const p = data.profile;
  const habits = [...(data.habits ?? []), ...(p?.style ?? [])];
  const stays = p ? [...p.stays.styles, ...p.stays.likes, ...(p.stays.price ? [p.stays.price] : [])] : [];
  const food = p ? [...p.food.cuisines, ...p.food.vibes] : [];
  const avoid = p ? [...p.stays.avoid, ...p.food.avoid] : [];
  const picks = forYou?.member ? forYou.picks.filter((x) => DESTINATION_BY_KEY[x.key]).slice(0, 3) : [];
  const sources = (Object.entries(data.counts.bySource) as [SignalSource, number][]).filter(([, n]) => n > 0);

  return (
    <Card>
      <View style={{ gap: 6 }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <H2>{p ? "What Pylos has learned" : "Teach Pylos your taste"}</H2>
        {p?.summary ? <P>{p.summary}</P> : null}
      </View>
      {updating ? <Loading text="Updating with your latest trips…" /> : null}
      {habits.length ? (
        <Section title="How you travel">
          <Lines lines={habits} />
        </Section>
      ) : null}
      {stays.length ? (
        <Section title="Where you stay">
          <P style={{ fontSize: 17 }}>{stays.join(" · ")}</P>
        </Section>
      ) : null}
      {food.length ? (
        <Section title="Food and drink">
          <P style={{ fontSize: 17 }}>{food.join(" · ")}</P>
        </Section>
      ) : null}
      {p?.activities.length ? (
        <Section title="Likes doing">
          <P style={{ fontSize: 17 }}>{p.activities.join(" · ")}</P>
        </Section>
      ) : null}
      {avoid.length ? (
        <Section title="Not for you">
          <P style={{ fontSize: 17 }}>{avoid.join(" · ")}</P>
        </Section>
      ) : null}
      {p?.next?.length || picks.length ? (
        <Section title="What you'd love next">
          {p?.next?.length ? <Lines lines={p.next} /> : null}
          {picks.map((x) => {
            const d = DESTINATION_BY_KEY[x.key]!;
            return (
              <Pressable
                key={x.key}
                accessibilityRole="button"
                accessibilityLabel={`${d.name}, ${d.country}. ${x.why}`}
                onPress={() => router.push(`/d/${x.key}`)}
                style={({ pressed }) => ({ backgroundColor: t.sunk, borderRadius: 16, padding: 14, gap: 3, opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ color: t.ink, fontFamily: FONT.display, fontSize: 18 }}>
                  {flag(d.countryCode)} {d.name}
                </Text>
                <Text style={{ color: t.ink, fontSize: 15.5, lineHeight: 21 }}>{x.why}</Text>
              </Pressable>
            );
          })}
        </Section>
      ) : null}
      <P muted style={{ fontSize: 14.5 }}>
        {`Learned from ${[
          data.counts.pastTrips ? `${data.counts.pastTrips} ${data.counts.pastTrips === 1 ? "trip" : "trips"}` : "",
          data.counts.total ? `${data.counts.total} ${data.counts.total === 1 ? "place" : "places"}` : "",
          data.counts.thumbs ? `${data.counts.thumbs} thumbs on Pylos plans` : "",
        ]
          .filter(Boolean)
          .join(", ") || "nothing yet"}${sources.length ? ` (${sources.map(([s, n]) => `${SIGNAL_SOURCE_LABELS[s]} ${n}`).join(", ")})` : ""}.`}
      </P>
    </Card>
  );
}
