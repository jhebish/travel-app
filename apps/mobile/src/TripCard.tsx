import type { CommunityTrip } from "@travel/core";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { FONT, useTheme } from "./theme";
import { Text } from "./ui";

/** A traveler's public trip, as on the site's cards: where, how long, who made it, its likes. */
export function TripCard({ trip }: { trip: CommunityTrip }) {
  const t = useTheme();
  const router = useRouter();
  const meta = [trip.party, trip.pace, trip.budget].filter(Boolean).join(" · ") + (trip.interests.length ? ` · ${trip.interests.slice(0, 3).join(", ")}` : "");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trip.title}, by ${trip.owner.displayName}, ${trip.likes} likes`}
      onPress={() => router.push(`/c/${trip.id}`)}
      style={({ pressed }) => ({ borderWidth: 1, borderColor: t.line, borderRadius: 18, padding: 16, gap: 6, backgroundColor: t.surface, opacity: pressed ? 0.85 : 1 })}
    >
      <Text style={{ color: t.muted, fontFamily: FONT.display, fontSize: 12, letterSpacing: 1.6, textTransform: "uppercase" }}>
        {trip.destination.split(",")[0]} · {trip.days} {trip.days === 1 ? "day" : "days"}
      </Text>
      <Text style={{ color: t.ink, fontSize: 19, fontWeight: "700", lineHeight: 24 }}>{trip.title}</Text>
      {meta ? <Text style={{ color: t.muted, fontSize: 14.5 }}>{meta}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: "500" }}>{trip.owner.displayName}</Text>
        <Text style={{ color: t.muted, fontSize: 15 }}>
          {trip.iLiked ? "♥" : "♡"} {trip.likes}
          {trip.ownerRating > 0 ? <Text style={{ color: t.saffron }}> · {"★".repeat(trip.ownerRating)}</Text> : null}
        </Text>
      </View>
    </Pressable>
  );
}
