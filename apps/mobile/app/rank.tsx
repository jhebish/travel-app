import { pairKey, type RankCard, type RankedGroup, type RankState, type TripRankState } from "@travel/core";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { api, ApiError } from "../src/api";
import { useAuth } from "../src/auth";
import { photoUri } from "../src/PhotoGallery";
import { FONT, useTheme } from "../src/theme";
import { Button, Card, Chip, H1, H2, Label, Loading, P, Screen, Status, styles, Text } from "../src/ui";

/**
 * "Which did you love more?": the same ranking as the website, on the phone.
 *   /rank                 your places      /rank?kind=trip   your past trips
 *   /rank?trip=<id>       one past trip's places
 *   /rank?plan=<id>       a Pylos trip's stops and hotels, after it (the morning-after reminder opens this)
 */

const ROUND = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type State = RankState | TripRankState;
const isTrip = (s: State): s is TripRankState => "tripId" in s;

function PairCard({ card, chosen, disabled, onPress }: { card: RankCard; chosen: boolean; disabled: boolean; onPress: () => void }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`I loved ${card.name} more`}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          gap: 4,
          padding: 8,
          paddingBottom: 12,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: chosen ? t.accent : t.line,
          backgroundColor: chosen ? t.accentSoft : t.bg,
          opacity: disabled && !chosen ? 0.6 : 1,
          transform: [{ scale: pressed ? 0.98 : chosen ? 1.02 : 1 }],
        })}
      >
        <View style={{ aspectRatio: 4 / 3, borderRadius: 12, overflow: "hidden", backgroundColor: t.sunk, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
          {card.photo && !failed ? (
            <Image source={{ uri: photoUri(card.photo.name, 400) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} onError={() => setFailed(true)} />
          ) : (
            <Text style={{ fontFamily: FONT.display, fontSize: 40, color: t.faint }}>{card.name.slice(0, 1)}</Text>
          )}
        </View>
        <Text style={{ fontFamily: FONT.display, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: t.muted }}>{card.kind}</Text>
        <Text style={{ fontFamily: FONT.display, fontSize: 18, lineHeight: 22, color: t.ink }}>{card.name}</Text>
        {card.where ? <Text style={{ fontStyle: "italic", color: t.muted, fontSize: 15 }}>{card.where}</Text> : null}
      </Pressable>
      {card.photo?.by ? (
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.faint, paddingHorizontal: 6 }}>
          {card.photo.by} · Google Maps
        </Text>
      ) : null}
    </View>
  );
}

function Progress({ done }: { done: number }) {
  const t = useTheme();
  const n = done % ROUND;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessible accessibilityLabel={`${n} of ${ROUND} this round`}>
      {Array.from({ length: ROUND }, (_, i) => (
        <View key={i} style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: i < n ? t.accent : t.line, backgroundColor: i < n ? t.accent : t.sunk }} />
      ))}
      <Text style={{ color: t.muted, fontSize: 14, marginLeft: 4, fontVariant: ["tabular-nums"] }}>
        {n} of {ROUND}
      </Text>
    </View>
  );
}

function Ranked({ groups, title, hint }: { groups: RankedGroup[]; title: string; hint?: string }) {
  const t = useTheme();
  const shown = groups.filter((g) => g.items.length);
  if (!shown.length) return null;
  return (
    <Card>
      <H2>{title}</H2>
      {hint ? <Status text={hint} /> : null}
      {shown.map((g) => (
        <View key={g.group} style={{ gap: 8 }}>
          {shown.length > 1 ? <Label>{g.label}</Label> : null}
          {g.items.map((x, i) => (
            <View key={x.id} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: i === 0 ? t.ochre : t.sunk, marginTop: 1 }}>
                <Text style={{ fontFamily: FONT.display, fontSize: 12.5, color: i === 0 ? t.ink : t.muted }}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, color: t.ink, fontSize: 17, lineHeight: 24 }}>
                <Text style={{ fontWeight: "600", color: t.ink, fontSize: 17 }}>{x.name}</Text>
                {x.where ? <Text style={{ color: t.muted, fontSize: 15 }}> {x.where}</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

export default function RankScreen() {
  const params = useLocalSearchParams<{ kind?: string; trip?: string; plan?: string }>();
  const router = useRouter();
  const t = useTheme();
  const { ready, session } = useAuth();
  const userId = session?.user.id;
  const plan = params.plan && UUID.test(params.plan) ? params.plan : null;
  const trip = !plan && params.trip && UUID.test(params.trip) ? params.trip : null;
  const kind: "trip" | "place" = !plan && !trip && params.kind === "trip" ? "trip" : "place";
  const path = plan ? `/api/trips/${plan}/rank` : "/api/rank";
  const query = plan ? "" : `?kind=${kind}${trip ? `&trip=${trip}` : ""}`;

  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedIn, setFinishedIn] = useState<number | null>(null);
  const skipped = useRef<string[]>([]);

  const load = useCallback(() => {
    setErr(null);
    return api<State>(`${path}${query}`)
      .then((s) => {
        setState(s);
        if (s.pair) setStartedAt((x) => x ?? Date.now());
      })
      .catch((e) => setErr(e instanceof ApiError && e.code === "rank_off" ? "Ranking isn't switched on yet. Try again soon." : (e as Error).message));
  }, [path, query]);

  useEffect(() => {
    if (!ready || !userId) return;
    setState(null);
    setDone(0);
    setFinishedIn(null);
    setStartedAt(null);
    skipped.current = [];
    void load();
  }, [ready, userId, load]);

  async function send(body: Record<string, unknown>, key: string, counts: boolean) {
    setBusy(key);
    setErr(null);
    try {
      const extra = plan ? {} : { kind, trip };
      const s = await api<State>(path, { method: "POST", json: { ...extra, ...body, skipped: skipped.current } });
      setState(s);
      if (counts) {
        const n = done + 1;
        setDone(n);
        if (n % ROUND === 0) {
          if (startedAt != null) setFinishedIn(Date.now() - startedAt);
          // A round's answers go into the taste profile straight away.
          void api("/api/taste/refresh", { method: "POST" }).catch(() => {});
        }
      }
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof ApiError && e.code === "gone") void load();
    } finally {
      setBusy(null);
    }
  }
  const pick = (w: RankCard, l: RankCard) => void send({ winner: w.id, loser: l.id }, w.id, true);
  const skip = (a: RankCard, b: RankCard) => {
    skipped.current = [...skipped.current, pairKey(a.id, b.id)].slice(-60);
    void send({ skip: [a.id, b.id] }, "skip", false);
  };

  const title = plan ? "Rank the trip" : kind === "trip" ? "Rank your trips" : "Rank your places";
  const s = state;
  const roundOver = finishedIn != null;
  const secs = finishedIn != null ? Math.max(1, Math.round(finishedIn / 1000)) : 0;

  let favourites: { groups: RankedGroup[]; title: string; hint?: string } | null = null;
  if (s && isTrip(s)) {
    favourites = {
      groups: s.favourites,
      title: s.together ? (s.mineOnly ? "Your favourites so far" : "The group's favourites") : `Your favourites from ${s.city}`,
      hint: s.together ? (s.mineOnly ? "The group's favourites show once someone else ranks too." : `Ranked by ${s.voters} of the ${s.people} of you.`) : undefined,
    };
  } else if (s) {
    const where = s.trip?.city;
    favourites = {
      groups: s.ranked,
      title: kind === "trip" ? "Your top trips" : where ? `Your top places in ${where}` : "Your top places",
      hint: `From your ${s.votes} ${s.votes === 1 ? "answer" : "answers"}. Places are only compared with their own kind.`,
    };
  }
  const items = s && !isTrip(s) ? s.items : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: plan && s && isTrip(s) ? s.city : "Rank" }} />
      <Card>
        <H1>{title}</H1>
        <P muted>Tap the one you loved more. Five quick answers and Pylos knows your favourites.</P>
        {!plan && !trip ? (
          <View style={styles.wrap}>
            <Chip label="Places" on={kind === "place"} onPress={() => router.setParams({ kind: "place" })} />
            <Chip label="Trips" on={kind === "trip"} onPress={() => router.setParams({ kind: "trip" })} />
          </View>
        ) : null}
      </Card>

      {!s ? (
        err ? <Status text={err} err /> : <Loading text="Finding two to compare…" />
      ) : isTrip(s) && !s.open ? (
        <Card>
          <P muted>You can rank this trip the morning after it ends.</P>
        </Card>
      ) : s.pair && !roundOver ? (
        <Card>
          <View style={{ flexDirection: "row", gap: 12 }} accessibilityLabel="Which did you love more?">
            <PairCard card={s.pair[0]} chosen={busy === s.pair[0].id} disabled={!!busy} onPress={() => pick(s.pair![0], s.pair![1])} />
            <PairCard card={s.pair[1]} chosen={busy === s.pair[1].id} disabled={!!busy} onPress={() => pick(s.pair![1], s.pair![0])} />
          </View>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Button ghost title={busy === "skip" ? "Finding another pair…" : "Can't decide"} disabled={!!busy} onPress={() => skip(s.pair![0], s.pair![1])} />
            <Progress done={done} />
          </View>
        </Card>
      ) : roundOver ? (
        <Card style={{ backgroundColor: t.hero, borderColor: t.hero }}>
          <H2>{`${ROUND} in ${secs} seconds${secs <= 60 ? ". Nicely done." : "."}`}</H2>
          <P muted>Every answer sharpens what Pylos picks for you next time.</P>
          {s.pair ? (
            <Button
              ghost
              title="Keep going"
              onPress={() => {
                setFinishedIn(null);
                setStartedAt(Date.now());
              }}
            />
          ) : null}
        </Card>
      ) : (
        <Card>
          {items != null && items < 2 ? (
            <>
              <H2>{kind === "trip" ? "Log at least two trips to rank them" : "Log a few places you loved first"}</H2>
              <P muted>On the website&apos;s You page, type a city and tick what you loved, or scan your calendar and photos on the You tab. Then come back and choose between them.</P>
            </>
          ) : (
            <>
              <H2>That&apos;s everything for now</H2>
              <P muted>{isTrip(s) ? "You've ranked every stop on this trip." : "Log more places and they join the ranking."}</P>
            </>
          )}
        </Card>
      )}
      {s && err ? <Status text={err} err /> : null}
      {favourites ? (
        favourites.groups.length ? (
          <Ranked groups={favourites.groups} title={favourites.title} hint={favourites.hint} />
        ) : s && isTrip(s) && s.together && s.voters > 0 ? (
          <Status text="Once two of you have ranked, the group's favourites show here." />
        ) : null
      ) : null}
      {plan ? <Button ghost title="Open the trip" onPress={() => router.push(`/trip/${plan}`)} /> : null}
    </Screen>
  );
}
