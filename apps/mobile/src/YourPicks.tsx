import type { FriendsMe } from "@travel/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Switch, View } from "react-native";
import { api } from "./api";
import { useTheme } from "./theme";
import { Badge, Button, Card, H2, P, Status, Text } from "./ui";

/**
 * Your picks, as on the site: the cities you're a local expert in, how many friends your places
 * helped ("used 3 times in Lisbon"), and whether friends' planners may use the places you loved.
 */
export function YourPicksCard() {
  const t = useTheme();
  const router = useRouter();
  const [data, setData] = useState<(FriendsMe & { off?: boolean }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      api<FriendsMe & { off?: boolean }>("/api/friends/me")
        .then(setData)
        .catch(() => {});
    }, []),
  );
  if (!data || data.off) return null;
  const { credits, localCities } = data;

  async function share(on: boolean) {
    setErr(null);
    setData((d) => (d ? { ...d, picksForFriends: on } : d));
    try {
      const r = await api<{ picksForFriends: boolean }>("/api/friends/me", { method: "PUT", json: { picksForFriends: on } });
      setData((d) => (d ? { ...d, picksForFriends: r.picksForFriends } : d));
    } catch (e) {
      setData((d) => (d ? { ...d, picksForFriends: !on } : d));
      setErr((e as Error).message);
    }
  }

  return (
    <Card>
      <View style={{ gap: 8 }}>
        <H2>Your picks</H2>
        {localCities.length ? <Badge text={`Local expert: ${localCities.map((c) => c.label).join(", ")}`} tone="season" /> : null}
      </View>
      {credits.friends > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: t.ink, fontSize: 17.5, fontWeight: "700" }}>
            Your picks helped {credits.friends} {credits.friends === 1 ? "friend" : "friends"}
          </Text>
          {credits.cities.map((c) => (
            <Text key={c.key} style={{ color: t.muted, fontSize: 15.5 }}>
              {c.label}: used {c.uses} {c.uses === 1 ? "time" : "times"}
            </Text>
          ))}
        </View>
      ) : (
        <P muted style={{ fontSize: 16 }}>
          When friends plan with places you loved, or you answer their questions, you&apos;ll see it here.
        </P>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ color: t.ink, fontSize: 16, flexShrink: 1 }}>Let friends&apos; planners use places I loved</Text>
        <Switch accessibilityLabel="Let friends' planners use places I loved" value={data.picksForFriends} onValueChange={(on) => void share(on)} />
      </View>
      <Status text={err} err />
      <Button ghost title="Questions from friends" onPress={() => router.push("/friends")} />
    </Card>
  );
}
