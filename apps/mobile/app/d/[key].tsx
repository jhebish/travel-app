import { DESTINATION_BY_KEY, dayRange, flag, inSeason, monthsLabel, readOnlyTrip, type CommunityTrip, type Destination } from "@travel/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { api } from "../../src/api";
import { DaysSlider } from "../../src/DaysSlider";
import { useTheme } from "../../src/theme";
import { TripCard } from "../../src/TripCard";
import { TripView } from "../../src/TripView";
import { useDaysPlan, type Plan } from "../../src/useDaysPlan";
import { Badge, Button, Card, Eyebrow, H1, H2, Loading, P, Screen, Status } from "../../src/ui";

/** A destination from Browse: its itinerary, fit to your days, the trips travelers loved there, and planning your own. */
export default function DestinationScreen() {
  const { key, days } = useLocalSearchParams<{ key: string; days?: string }>();
  const d = key ? DESTINATION_BY_KEY[key] : undefined;
  if (!d) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Not found" }} />
        <Status text="We don't have that destination." err />
      </Screen>
    );
  }
  return <DestinationTrip key={d.key} d={d} startDays={Number(days)} />;
}

function DestinationTrip({ d, startDays }: { d: Destination; startDays: number }) {
  const t = useTheme();
  const router = useRouter();
  const range = dayRange(d);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [trips, setTrips] = useState<CommunityTrip[]>([]);
  const [days, setDays] = useState(startDays >= range.min && startDays <= range.max ? startDays : d.sampleDays);

  // The usual itinerary, planned once for everyone the first time anyone opens the place.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (tries = 0) => {
      const r = await api<{ sample: Plan; trips: CommunityTrip[] }>(`/api/browse/${d.key}`).catch(() => null);
      if (!alive) return;
      if (!r) return setPlan({ status: "failed" });
      setTrips(r.trips);
      setPlan(r.sample);
      if (r.sample.status === "pending" && tries === 0) {
        const p = await api<{ sample: Plan }>(`/api/browse/${d.key}/sample`, { method: "POST" }).catch(() => null);
        if (!alive) return;
        if (!p) return setPlan({ status: "failed" });
        setPlan(p.sample);
        if (p.sample.status === "generating") timer = setTimeout(() => load(tries + 1), 4000);
      } else if (r.sample.status === "generating") {
        // Polling that runs out ends as failed, not as a spinner that never stops.
        if (tries < 30) timer = setTimeout(() => load(tries + 1), 4000);
        else setPlan({ status: "failed" });
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [d.key]);

  const fitted = useDaysPlan(d, plan?.status === "ready" ? plan.itinerary : null, days);
  const where = d.kind === "region" ? d.name : `${d.name}, ${d.country}`;
  const trip = useMemo(() => (fitted.itinerary ? readOnlyTrip({ destination: where, title: fitted.itinerary.title, itinerary: fitted.itinerary }) : null), [fitted.itinerary, where]);
  const planTrip = (destination: string, n: number, mode: "single" | "multi") =>
    router.push({ pathname: "/plan", params: { destination, days: String(n), mode, at: String(Date.now()) } });
  const planMine = () => planTrip(where, days, d.kind === "region" ? "multi" : "single");
  const month = new Date().getMonth() + 1;
  const failed = plan?.status === "failed" || plan?.status === "unavailable" || fitted.failed;

  return (
    <Screen>
      <Stack.Screen options={{ title: d.name }} />
      <View style={{ gap: 8, paddingTop: 4 }}>
        <Eyebrow>
          {flag(d.countryCode)} {d.kind === "region" ? `Several stops · ${d.country}` : d.country}
        </Eyebrow>
        <H1>{d.name}</H1>
        {inSeason(d, month) || d.trend ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {inSeason(d, month) ? <Badge text="In season now" tone="season" /> : null}
            {d.trend ? <Badge text={d.trend} tone="trend" /> : null}
          </View>
        ) : null}
        <P>{d.blurb}</P>
        <P muted style={{ fontSize: 15.5 }}>
          Best months: {monthsLabel(d.bestMonths)}
        </P>
      </View>

      {plan?.status === "ready" ? (
        <Card>
          <DaysSlider
            value={days}
            min={range.min}
            max={range.max}
            onChange={setDays}
            note={fitted.planning ? `Planning ${days} days in ${d.name}… (once, then it's instant for everyone)` : undefined}
          />
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <Button title="Plan my own trip here" onPress={planMine} />
        {d.kind === "city" ? <Button ghost title={`Several stops in ${d.country}`} onPress={() => planTrip(d.country, 7, "multi")} /> : null}
      </View>

      {trip ? (
        <TripView trip={trip} readOnly />
      ) : (
        <Card>
          {failed ? (
            // A failure isn't shown as loading: it isn't going to finish on its own.
            <Status
              text={
                fitted.failed
                  ? `We couldn't plan ${days} days here just now. Try fewer days, or plan your own.`
                  : plan?.status === "unavailable"
                    ? `Itineraries for ${d.name} are coming soon. Plan your own in the meantime.`
                    : "This itinerary isn't ready yet. Try again in a minute, or plan your own."
              }
            />
          ) : (
            <Loading text={`Planning ${days} days in ${d.name} with local picks…`} />
          )}
        </Card>
      )}

      {trips.length > 0 ? (
        <View style={{ gap: 12 }}>
          <H2>Trips travelers loved in {d.name}</H2>
          {trips.slice(0, 4).map((x) => (
            <TripCard key={x.id} trip={x} />
          ))}
        </View>
      ) : null}

      <Card style={{ backgroundColor: t.hero, borderColor: t.hero }}>
        <H2>Want your own version?</H2>
        <P>Tell Pylos who&apos;s coming and what you&apos;re into. Free, and it takes about a minute.</P>
        <Button title="Plan my own version" onPress={planMine} />
      </Card>
    </Screen>
  );
}
