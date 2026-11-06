import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { api } from "../../src/api";
import { scanCalendar, scanPhotos } from "../../src/deviceImports";
import { Button, Card, H1, H2, Loading, P, Screen, Status } from "../../src/ui";

type Busy = null | "calendar" | "photos";

/** Teach Pylos your taste by allowing the calendar and photos already on this phone. */
export default function You() {
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const loadTaste = useCallback(() => {
    api<{ profile: { summary?: string } | null }>("/api/taste")
      .then((r) => setSummary(r.profile?.summary ?? null))
      .catch(() => {});
  }, []);
  useFocusEffect(loadTaste);

  async function run(kind: Exclude<Busy, null>) {
    setBusy(kind);
    setMsg(null);
    setProgress("");
    try {
      if (kind === "calendar") {
        const r = await scanCalendar(setProgress);
        setMsg({
          text: r.places
            ? `Found ${r.places} ${r.places === 1 ? "place" : "places"} in your calendar${r.trips ? `, and ${r.trips} new past ${r.trips === 1 ? "trip" : "trips"}` : ""}.`
            : "No trips, hotel stays or reservations turned up in your calendar.",
        });
      } else {
        const r = await scanPhotos(setProgress);
        const names = [...new Set(r.trips.map((t) => t.city))];
        setMsg({
          text: names.length
            ? `Your photos show trips to ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}. ${r.added} added to your places.${r.limited ? " You shared only some photos; allow all photos in Settings for a full scan." : ""}`
            : `We didn't find trips away from home in your photos.${r.limited ? " You shared only some photos; allow all photos in Settings for a full scan." : ""}`,
        });
      }
      // Rebuild the taste profile with what was found.
      await api("/api/taste/refresh", { method: "POST" }).catch(() => {});
      loadTaste();
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  return (
    <Screen>
      <Card>
        <H1>You</H1>
        <P muted>Let Pylos learn where you&apos;ve been and what you loved, so it can predict the hotels and restaurants you&apos;ll like next.</P>
        {summary ? <P>{summary}</P> : null}
      </Card>
      <Card>
        <H2>Calendar on this phone</H2>
        <P muted>
          Past trips, hotel stays and restaurant reservations, including Resy and OpenTable bookings, from your iCloud, Google or Outlook calendars. Only the places it finds
          are saved.
        </P>
        <Button title={busy === "calendar" ? "Reading…" : "Allow and scan"} onPress={() => run("calendar")} disabled={!!busy} />
      </Card>
      <Card>
        <H2>Photos</H2>
        <P muted>Where and when your photos were taken shows the trips you&apos;ve been on. Your photos never leave your phone; only the cities and dates are saved.</P>
        <Button title={busy === "photos" ? "Looking…" : "Allow and scan"} onPress={() => run("photos")} disabled={!!busy} />
      </Card>
      {progress ? <Loading text={progress} /> : null}
      <Status text={msg?.text} err={msg?.err} />
    </Screen>
  );
}
