import type { TripSummary } from "@travel/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { signOut } from "../../src/notifications";
import { ReminderOptIn } from "../../src/RankCards";
import { useTheme } from "../../src/theme";
import { Button, Card, Chip, H1, Loading, P, Screen, Status, styles, Text } from "../../src/ui";

type Filter = "all" | "saved" | "rated";
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function Trips() {
  const t = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const isGuest = !!session?.user.is_anonymous;
  const [filter, setFilter] = useState<Filter>("all");
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  // Trips friends are planning with you (Plan together), as on the site.
  const [shared, setShared] = useState<(TripSummary & { owner: string })[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api<{ trips: TripSummary[]; shared?: (TripSummary & { owner: string })[] }>(`/api/trips${filter === "all" ? "" : `?filter=${filter}`}`)
        .then((r) => {
          if (!alive) return;
          setTrips(r.trips);
          if (filter === "all") setShared(r.shared ?? []);
        })
        .catch((e) => alive && setErr((e as Error).message));
      return () => {
        alive = false;
      };
    }, [filter]),
  );

  async function remove(id: string) {
    if (confirm !== id) return setConfirm(id);
    setConfirm(null);
    try {
      await api(`/api/trips/${id}`, { method: "DELETE" });
      setTrips((x) => x?.filter((y) => y.id !== id) ?? null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Screen>
      <ReminderOptIn />
      <Card>
        <H1>My trips</H1>
        <P muted>Every trip you build is kept here, private to you.</P>
        <View style={styles.wrap}>
          {(["all", "saved", "rated"] as Filter[]).map((f) => (
            <Chip key={f} label={f === "all" ? "All" : f === "saved" ? "Saved" : "Rated"} on={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
        <Status text={err} err />
        {!trips ? (
          <Loading text="Loading your trips…" />
        ) : !trips.length ? (
          <P muted>{filter === "all" ? "No trips yet. Build one on the Plan tab, or start from a place on Browse." : "Nothing here yet."}</P>
        ) : (
          trips.map((trip, i) => (
            <View key={trip.id} style={{ gap: 8, paddingTop: i ? 14 : 0, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
              <Pressable onPress={() => router.push(`/trip/${trip.id}`)}>
                <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>
                  {trip.title}
                  {trip.saved ? <Text style={{ color: t.accent, fontSize: 12 }}>  · SAVED</Text> : null}
                </Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  {trip.destination} · {trip.days} {trip.days === 1 ? "day" : "days"} · {fmt(trip.createdAt)}
                  {trip.hasHotels ? " · with hotels" : ""}
                </Text>
                {trip.rating > 0 && <Text style={{ color: t.saffron }}>{"★".repeat(trip.rating)}<Text style={{ color: t.line }}>{"★".repeat(5 - trip.rating)}</Text></Text>}
              </Pressable>
              <View style={styles.row}>
                <Button ghost title="Open" onPress={() => router.push(`/trip/${trip.id}`)} />
                <Button ghost title="Plan again" onPress={() => router.push({ pathname: "/plan", params: { from: trip.id } })} />
                <Button ghost danger={confirm === trip.id} title={confirm === trip.id ? "Confirm remove" : "Remove"} onPress={() => remove(trip.id)} />
              </View>
            </View>
          ))
        )}
      </Card>
      {shared.length > 0 && (
        <Card>
          <Text style={{ color: t.ink, fontSize: 22, fontWeight: "800" }}>Planning with friends</Text>
          <P muted style={{ fontSize: 16 }}>
            Trips friends added you to. Say which stops you&apos;re in for, swap stops and rebuild days.
          </P>
          {shared.map((trip, i) => (
            <Pressable key={trip.id} onPress={() => router.push(`/trip/${trip.id}`)} style={{ gap: 2, paddingTop: i ? 14 : 0, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
              <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>{trip.title}</Text>
              <Text style={{ color: t.muted, fontSize: 13 }}>
                {trip.destination} · {trip.days} {trip.days === 1 ? "day" : "days"} · with {trip.owner}
              </Text>
            </Pressable>
          ))}
        </Card>
      )}
      {isGuest ? (
        <Button ghost title="Sign in to keep trips across devices" onPress={() => router.push("/login")} />
      ) : (
        <Button ghost title="Sign out" onPress={() => void signOut()} />
      )}
    </Screen>
  );
}
