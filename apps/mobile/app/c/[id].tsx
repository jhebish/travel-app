import { readOnlyTrip, type CommunityTrip } from "@travel/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { useTheme } from "../../src/theme";
import { TripView } from "../../src/TripView";
import { Button, Loading, Screen, Status, Text } from "../../src/ui";

/** A traveler's public trip (from Browse's "Trips travelers loved"), read-only, with a way to plan your own. */
export default function CommunityTripScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<CommunityTrip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [likeErr, setLikeErr] = useState<string | null>(null);
  const [liking, setLiking] = useState(false);
  const { session } = useAuth();
  const member = !!session && !session.user.is_anonymous;

  async function like() {
    if (!trip) return;
    if (!member) return setLikeErr("Sign in on the You tab to like trips.");
    setLiking(true);
    setLikeErr(null);
    try {
      const r = await api<{ liked: boolean; likes: number }>(`/api/community/trips/${trip.id}/like`, { method: trip.iLiked ? "DELETE" : "POST" });
      setTrip({ ...trip, iLiked: r.liked, likes: r.likes });
    } catch (e) {
      setLikeErr((e as Error).message);
    } finally {
      setLiking(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    api<{ trip: CommunityTrip }>(`/api/community/trips/${id}`)
      .then((r) => setTrip(r.trip))
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  const view = useMemo(
    () => (trip?.itinerary ? readOnlyTrip({ destination: trip.destination, title: trip.title, itinerary: trip.itinerary, party: trip.party, createdAt: trip.createdAt }) : null),
    [trip],
  );
  const planMine = () =>
    trip &&
    router.push({ pathname: "/plan", params: { destination: trip.destination, days: String(trip.days), mode: view?.request.mode ?? "single", at: String(Date.now()) } });

  return (
    <Screen>
      <Stack.Screen options={{ title: trip ? trip.destination.split(",")[0]! : "Trip" }} />
      {err ? (
        <Status text={err} err />
      ) : !trip ? (
        <Loading text="Loading trip…" />
      ) : (
        <>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <Text style={{ color: t.muted, fontSize: 16, flexShrink: 1 }}>By {trip.owner.displayName}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={trip.iLiked ? `Unlike, ${trip.likes} likes` : `Like, ${trip.likes} likes`}
              accessibilityState={{ selected: trip.iLiked, disabled: liking }}
              onPress={() => void like()}
              disabled={liking}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: trip.iLiked ? t.bad : t.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14, opacity: liking ? 0.6 : 1 }}
            >
              <Text style={{ color: trip.iLiked ? t.bad : t.ink, fontSize: 17 }}>{trip.iLiked ? "♥" : "♡"}</Text>
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>{trip.likes}</Text>
              {trip.ownerRating > 0 ? <Text style={{ color: t.saffron, fontSize: 15 }}> {"★".repeat(trip.ownerRating)}</Text> : null}
            </Pressable>
          </View>
          <Status text={likeErr} err />
          {view ? <TripView trip={view} readOnly /> : <Status text="This trip's plan isn't shared." />}
          <Button title="Plan my own version" onPress={planMine} />
        </>
      )}
    </Screen>
  );
}
