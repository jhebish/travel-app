import { countryName, flag, travelStats, type PastTrip } from "@travel/core";
import { Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { api } from "../src/api";
import { useTheme } from "../src/theme";
import { Button, Card, H1, Label, Loading, P, Screen, Status, Text } from "../src/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Portugal · May · 5 days" */
const detail = (p: PastTrip) => [countryName(p.countryCode), p.month ? MONTHS[p.month - 1] : null, p.days ? `${p.days} ${p.days === 1 ? "day" : "days"}` : null].filter(Boolean).join(" · ");

/**
 * Places you've been, as on the site's profile: every trip you've logged or a scan found, by year,
 * with your rating (the trips you rate highest weigh most in your taste). Remove ones that aren't right.
 */
export default function PlacesScreen() {
  const t = useTheme();
  const [places, setPlaces] = useState<PastTrip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ places: PastTrip[] }>("/api/community/places")
      .then((r) => setPlaces(r.places))
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const stats = useMemo(() => (places ? travelStats(places) : null), [places]);
  const years = useMemo(() => {
    const out = new Map<string, PastTrip[]>();
    for (const p of [...(places ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0) || a.city.localeCompare(b.city))) {
      const y = p.year ? String(p.year) : "Undated";
      out.set(y, [...(out.get(y) ?? []), p]);
    }
    return [...out];
  }, [places]);

  async function rate(p: PastTrip, rating: number) {
    setBusy(p.id);
    setErr(null);
    const next = p.rating === rating ? null : rating;
    try {
      // The whole trip, as the site's editor sends it; who sees it stays as it was.
      await api(`/api/community/places/${p.id}`, {
        method: "PUT",
        json: { city: p.city, countryCode: p.countryCode, year: p.year, month: p.month, days: p.days, rating: next, highlights: p.highlights, tripId: p.tripId },
      });
      setPlaces((list) => list?.map((x) => (x.id === p.id ? { ...x, rating: next } : x)) ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  function remove(p: PastTrip) {
    Alert.alert(`Remove ${p.city}${p.year ? ` (${p.year})` : ""}?`, "It comes off Places you've been, with the places you loved there.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(p.id);
          try {
            await api(`/api/community/places/${p.id}`, { method: "DELETE" });
            setPlaces((list) => list?.filter((x) => x.id !== p.id) ?? null);
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Places you've been" }} />
      <View style={{ gap: 8 }}>
        <H1>Places you&apos;ve been</H1>
        {stats && places?.length ? (
          <P muted>
            {stats.countries} {stats.countries === 1 ? "country" : "countries"}, {stats.cities} {stats.cities === 1 ? "city" : "cities"}, {stats.trips}{" "}
            {stats.trips === 1 ? "trip" : "trips"} · {stats.level.name}
            {stats.next ? ` (${stats.next.countriesToGo} more ${stats.next.countriesToGo === 1 ? "country" : "countries"} to ${stats.next.level.name})` : ""}
          </P>
        ) : null}
        <P muted style={{ fontSize: 16 }}>
          Rate the trips you loved most: they weigh most in your taste. Add the places you loved on each one on pylos.ai.
        </P>
      </View>
      <Status text={err} err />
      {!places ? (
        <Loading text="Loading your places…" />
      ) : !places.length ? (
        <Card>
          <P muted>Nothing yet. Scan your photos or calendar on the You tab and your trips show up here.</P>
        </Card>
      ) : (
        years.map(([year, list]) => (
          <Card key={year}>
            <Label>{year}</Label>
            {list.map((p, i) => (
              <View key={p.id} style={{ gap: 6, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, paddingTop: i ? 14 : 0 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: t.ink, fontSize: 18, fontWeight: "600" }}>
                      {flag(p.countryCode)} {p.city}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 15 }}>{detail(p)}</Text>
                    {p.highlights ? <Text style={{ color: t.ink, fontSize: 15, fontStyle: "italic" }}>{p.highlights}</Text> : null}
                  </View>
                  <Button ghost title="Remove" disabled={busy === p.id} onPress={() => remove(p)} />
                </View>
                <View style={{ flexDirection: "row", gap: 2 }} accessibilityLabel={`Rate ${p.city}`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Rate ${n} of 5`} hitSlop={6} disabled={busy === p.id} onPress={() => void rate(p, n)}>
                      <Text style={{ fontSize: 26, color: n <= (p.rating ?? 0) ? t.saffron : t.line }}>★</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </Card>
        ))
      )}
    </Screen>
  );
}
