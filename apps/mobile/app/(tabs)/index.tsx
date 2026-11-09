import { DESTINATION_BY_KEY, DESTINATION_TAGS, flag, monthsLabel, type BrowseDestination, type DestinationTag, type ForYouPick } from "@travel/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { Globe } from "../../src/Globe";
import { MadeForYouCard } from "../../src/MadeForYou";
import { FONT, useTheme } from "../../src/theme";
import { Badge, Button, Card, Chip, Eyebrow, H1, H2, Loading, P, Screen, Status, Text } from "../../src/ui";

interface ForYou {
  picks: ForYouPick[];
  placesLogged: number;
  needMore: boolean;
  member: boolean;
  signedIn: boolean;
}

/** Trending places shown before "Show all". */
const TRENDING_FIRST = 8;

const where = (d: Pick<BrowseDestination, "kind" | "country">) => (d.kind === "region" ? `Several stops · ${d.country}` : d.country);

/** The site's home page, for the phone: a globe of this season's places, picks for you, and what's trending. */
export default function Browse() {
  const t = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const [dests, setDests] = useState<BrowseDestination[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tag, setTag] = useState<DestinationTag | "All">("All");
  const [selected, setSelected] = useState<string | null>(null);
  const [forYou, setForYou] = useState<ForYou | null>(null);
  const [allTrending, setAllTrending] = useState(false);
  // A finger is turning the globe: the page holds still meanwhile.
  const [turning, setTurning] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    api<{ destinations: BrowseDestination[] }>("/api/browse")
      .then((r) => setDests(r.destinations))
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  // Picks follow the places logged, so look again on coming back (after a photo scan, say).
  const userId = session?.user.id;
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      api<ForYou>("/api/browse/foryou")
        .then(setForYou)
        .catch(() => {});
    }, [userId]),
  );

  const shown = useMemo(() => (dests ?? []).filter((d) => tag === "All" || d.tags.includes(tag)), [dests, tag]);
  const markers = useMemo(() => {
    const max = Math.max(1, ...shown.map((d) => d.score));
    return shown.map((d) => ({ key: d.key, name: d.name, sub: d.country, lat: d.lat, lng: d.lng, heat: d.score / max }));
  }, [shown]);
  const current = dests?.find((d) => d.key === selected) ?? null;
  const guest = !session || !!session.user.is_anonymous;
  const member = !!forYou?.member;
  const open = (key: string) => router.push(`/d/${key}`);
  const planHere = (d: BrowseDestination) =>
    router.push({ pathname: "/plan", params: { destination: d.kind === "region" ? d.name : `${d.name}, ${d.country}`, days: String(d.sampleDays), mode: d.kind === "region" ? "multi" : "single", at: String(Date.now()) } });
  // Two cards a row: the page's 16 padding each side and 12 between them.
  const cardWidth = Math.floor((width - 44) / 2);

  return (
    <Screen scrollEnabled={!turning}>
      <View style={{ gap: 8, paddingTop: 4 }}>
        <Eyebrow>Trips planned the local way</Eyebrow>
        <H1>Where to next?</H1>
        <P muted>Turn the globe and tap a pin for an itinerary you can fit to your days, and the best-rated trips there. Pins are this season&apos;s trending places.</P>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {(["All", ...DESTINATION_TAGS] as const).map((x) => (
          <Chip key={x} label={x} on={tag === x} onPress={() => setTag(x)} />
        ))}
      </ScrollView>

      {err ? (
        <View style={{ gap: 10 }}>
          <Status text={err} err />
          {!dests ? <Button ghost title="Try again" onPress={load} /> : null}
        </View>
      ) : !dests ? (
        <Loading text="Finding this season's places…" />
      ) : null}

      <Globe markers={markers} selected={selected} onSelect={setSelected} onActive={setTurning} size={Math.min(width - 32, 420)} />

      <Card>
        {current ? (
          <>
            <View style={{ gap: 6 }}>
              <Eyebrow>
                {flag(current.countryCode)} {where(current)}
              </Eyebrow>
              <H2>{current.name}</H2>
              <Badges d={current} />
            </View>
            <P>{current.blurb}</P>
            <P muted style={{ fontSize: 15.5 }}>
              Best months: {monthsLabel(current.bestMonths)}
            </P>
            <View style={{ gap: 10 }}>
              <Button title={`See ${current.sampleDays} days in ${current.name}`} onPress={() => open(current.key)} />
              <Button ghost title="Plan my own trip here" onPress={() => planHere(current)} />
            </View>
          </>
        ) : (
          <View style={{ gap: 8 }}>
            <H2>Pick a place to start</H2>
            <P muted>Tap a pin on the globe, or choose one of the places trending now, below.</P>
          </View>
        )}
      </Card>

      {/* For you: predictions from logged places, or (with an account) an invitation to log them. */}
      {member && forYou && forYou.picks.length > 0 ? (
        <Card>
          <View style={{ gap: 6 }}>
            <Eyebrow>Picked for you</Eyebrow>
            <H2>Where you&apos;ll probably love next</H2>
            <P muted style={{ fontSize: 15.5 }}>
              Based on the {forYou.placesLogged} places you&apos;ve logged.
            </P>
          </View>
          <View style={{ gap: 10 }}>
            {forYou.picks.map((p) => {
              const d = DESTINATION_BY_KEY[p.key];
              if (!d) return null;
              return (
                <Pressable
                  key={p.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.name}, ${d.country}. ${p.why}`}
                  onPress={() => open(p.key)}
                  style={({ pressed }) => ({ backgroundColor: t.sunk, borderRadius: 16, padding: 14, gap: 4, opacity: pressed ? 0.85 : 1 })}
                >
                  <Eyebrow>
                    {flag(d.countryCode)} {d.country}
                  </Eyebrow>
                  <Text style={{ color: t.ink, fontFamily: FONT.display, fontSize: 20 }}>{d.name}</Text>
                  <Text style={{ color: t.ink, fontSize: 16, lineHeight: 22 }}>{p.why}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : forYou?.signedIn && forYou.needMore && !guest ? (
        <Card style={{ backgroundColor: t.ochre, borderColor: t.ochre }}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: "700" }}>Get destinations picked for you</Text>
            <P style={{ fontSize: 16 }}>
              Add {Math.max(1, 2 - forYou.placesLogged)} more {2 - forYou.placesLogged === 1 ? "place" : "places"} you&apos;ve been and Pylos will predict where you&apos;ll love next. Your
              photos can find them for you.
            </P>
          </View>
          <Button ghost title="Find my trips" onPress={() => router.push("/you")} />
        </Card>
      ) : null}

      {dests && shown.length > 0 ? (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <H2>Trending now</H2>
            <P muted style={{ fontSize: 15.5 }}>
              In season this month, named on 2026 trend lists, or popular on Pylos.
            </P>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {(allTrending || tag !== "All" ? shown : shown.slice(0, TRENDING_FIRST)).map((d) => (
              <Pressable
                key={d.key}
                accessibilityRole="button"
                accessibilityLabel={`${d.name}, ${where(d)}. ${d.blurb}`}
                onPress={() => open(d.key)}
                style={({ pressed }) => ({
                  width: cardWidth,
                  backgroundColor: t.surface,
                  borderColor: d.key === selected ? t.ink : t.line,
                  borderWidth: 1,
                  borderRadius: 18,
                  padding: 14,
                  gap: 6,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text numberOfLines={1} style={{ color: t.muted, fontFamily: FONT.display, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
                  {flag(d.countryCode)} {d.kind === "region" ? `${d.country} · stops` : d.country}
                </Text>
                <Text numberOfLines={2} style={{ color: t.ink, fontFamily: FONT.display, fontSize: 19, lineHeight: 23 }}>
                  {d.name}
                </Text>
                <Text numberOfLines={3} style={{ color: t.muted, fontSize: 15, lineHeight: 20 }}>
                  {d.blurb}
                </Text>
                <View style={{ marginTop: "auto", paddingTop: 4 }}>
                  {d.inSeason ? <Badge text="In season" tone="season" /> : <Text style={{ color: t.muted, fontSize: 14 }}>Best {monthsLabel(d.bestMonths)}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
          {tag === "All" && shown.length > TRENDING_FIRST ? (
            <Button ghost title={allTrending ? "Show fewer" : `Show all ${shown.length} places`} onPress={() => setAllTrending(!allTrending)} />
          ) : null}
        </View>
      ) : null}

      {/* Why Pylos: it plans from what you've already loved, not the same list for everyone. */}
      <MadeForYouCard state={guest ? "out" : member && forYou?.picks.length ? "known" : "learning"} onStart={() => router.push("/you")} />
    </Screen>
  );
}

function Badges({ d }: { d: BrowseDestination }) {
  if (!d.inSeason && !d.trend && !d.publicTrips) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {d.inSeason ? <Badge text="In season now" tone="season" /> : null}
      {d.trend ? <Badge text={d.trend} tone="trend" /> : null}
      {d.publicTrips > 0 ? <Badge text={`${d.publicTrips} ${d.publicTrips === 1 ? "trip" : "trips"} on Pylos`} /> : null}
    </View>
  );
}
