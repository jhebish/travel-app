import type { PastStay } from "@travel/core";
import { Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { api } from "../src/api";
import { rateStay, removeStay, staySources, stayLine } from "../src/Stays";
import { useTheme } from "../src/theme";
import { Button, Card, H1, Label, Loading, P, Screen, Status, Text } from "../src/ui";

/**
 * Places you've stayed: every hotel and rental the calendar, email and photo scans found (and the
 * ones added on the site), newest first by year. Loved it / not for me steers hotel picks.
 */
export default function StaysScreen() {
  const t = useTheme();
  const [stays, setStays] = useState<PastStay[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ stays: PastStay[] }>("/api/taste/stays")
      .then((r) => setStays(r.stays))
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const years = useMemo(() => {
    const out = new Map<string, PastStay[]>();
    for (const s of stays ?? []) {
      const y = s.last?.slice(0, 4) ?? "Undated";
      out.set(y, [...(out.get(y) ?? []), s]);
    }
    return [...out];
  }, [stays]);

  async function rate(s: PastStay, liked: boolean | null) {
    setBusy(s.ids[0]!);
    setErr(null);
    try {
      await rateStay(s, liked);
      setStays((list) => list?.map((x) => (x === s ? { ...x, liked } : x)) ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  function remove(s: PastStay) {
    Alert.alert(`Remove ${s.name}?`, "It comes off Places you've stayed, and hotel picks stop using it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(s.ids[0]!);
          try {
            await removeStay(s);
            setStays((list) => list?.filter((x) => x !== s) ?? null);
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
      <Stack.Screen options={{ title: "Places you've stayed" }} />
      <View style={{ gap: 8 }}>
        <H1>Places you&apos;ve stayed</H1>
        <P muted>
          Every hotel and rental your calendar, email and photos turned up. Mark the ones you loved and the ones that weren&apos;t for you: Pylos picks hotels like the ones you
          loved, and never suggests the others.
        </P>
      </View>
      <Status text={err} err />
      {!stays ? (
        <Loading text="Gathering your stays…" />
      ) : !stays.length ? (
        <Card>
          <P muted>Nothing yet. Scan your calendar and photos on the You tab, and the places you stayed show up here.</P>
        </Card>
      ) : (
        years.map(([year, list]) => (
          <Card key={year}>
            <Label>{year}</Label>
            {list.map((s, i) => (
              <View key={s.ids[0]} style={{ gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, paddingTop: i ? 14 : 0 }}>
                <View style={{ gap: 2 }}>
                  <Text style={{ color: t.ink, fontSize: 18, fontWeight: "600" }}>{s.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 15 }}>{stayLine(s)}</Text>
                  <Text style={{ color: t.faint, fontSize: 13.5 }}>
                    {staySources(s)}
                    {s.note ? ` · ${s.note}` : ""}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Button ghost title={s.liked === true ? "♥ Loved it" : "Loved it"} disabled={busy === s.ids[0]} onPress={() => void rate(s, s.liked === true ? null : true)} />
                  <Button ghost danger={s.liked === false} title="Not for me" disabled={busy === s.ids[0]} onPress={() => void rate(s, s.liked === false ? null : false)} />
                  <Button ghost title="Remove" disabled={busy === s.ids[0]} onPress={() => remove(s)} />
                </View>
              </View>
            ))}
          </Card>
        ))
      )}
    </Screen>
  );
}
