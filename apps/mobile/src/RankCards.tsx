import { localDate, nudgeDue, type RankNudge, type RankNudges } from "@travel/core";
import { useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useState } from "react";
import { api } from "./api";
import { appRoute, askToNotify, notifyPermission } from "./notifications";
import { Button, Card, H2, P } from "./ui";

/** The You tab's way in to ranking, and "Back from Lisbon?" for a week after a trip. */
export function RankEntryCard() {
  const router = useRouter();
  const [nudge, setNudge] = useState<RankNudge | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api<RankNudges>("/api/rank/nudges")
        .then((r) => alive && setNudge(r.recent.find((n) => nudgeDue(n.overOn, localDate())) ?? null))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );
  return (
    <Card>
      {nudge ? (
        <>
          <H2>Back from {nudge.city}?</H2>
          <P muted>Rank 5 spots in 60 seconds. Pylos learns what you loved most and plans around it.</P>
          <Button title="Rank them" onPress={() => router.push(appRoute(nudge.href) ?? "/rank")} />
        </>
      ) : (
        <>
          <H2>Which did you love more?</H2>
          <P muted>Two of your places at a time, a tap each. Pylos learns your favourites and plans around them.</P>
          <Button ghost title="Rank your places" onPress={() => router.push("/rank")} />
        </>
      )}
    </Card>
  );
}

const NOT_NOW = "pylos.reminders.notNow";

/**
 * Asks to turn on reminders when it's useful: someone has a dated trip coming up and hasn't been
 * asked about it. "Not now" holds until their next trip.
 */
export function ReminderOptIn() {
  const [next, setNext] = useState<RankNudge | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if ((await notifyPermission()) !== "undetermined") return setNext(null);
        const [{ upcoming }, notNow] = await Promise.all([api<RankNudges>("/api/rank/nudges"), SecureStore.getItemAsync(NOT_NOW).catch(() => null)]);
        const first = upcoming[0] ?? null;
        if (alive) setNext(first && first.key !== notNow ? first : null);
      })().catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );
  if (!next) return null;
  return (
    <Card>
      <H2>A nudge after {next.city}</H2>
      <P muted>The morning after your trip, Pylos can remind you to rank your favourite spots. It takes a minute and makes your next plan better.</P>
      <Button
        title={busy ? "Turning on…" : "Turn on reminders"}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          await askToNotify().catch(() => false);
          setBusy(false);
          setNext(null);
        }}
      />
      <Button
        ghost
        title="Not now"
        onPress={() => {
          void SecureStore.setItemAsync(NOT_NOW, next.key).catch(() => {});
          setNext(null);
        }}
      />
    </Card>
  );
}
