import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { api } from "../../src/api";
import { AsksCard } from "../../src/AsksCard";
import { useAuth } from "../../src/auth";
import { saveTrips, scanCalendar, scanPhotos, type FoundTrip } from "../../src/deviceImports";
import { signOut } from "../../src/notifications";
import { RankEntryCard } from "../../src/RankCards";
import { supabase } from "../../src/supabase";
import { TripReview } from "../../src/TripReview";
import { Button, Card, H1, H2, Loading, P, Screen, Status } from "../../src/ui";

type Busy = null | "calendar" | "photos";
const LIMITED = "You shared only some photos; allow all photos in Settings for a full scan.";

/** Teach Pylos your taste by allowing the calendar and photos already on this phone. */
export default function You() {
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const { session } = useAuth();
  const router = useRouter();
  const email = session?.user && !session.user.is_anonymous ? session.user.email : undefined;
  const [deleting, setDeleting] = useState(false);
  // Trips a scan found, waiting for the person to check them before they're added.
  const [review, setReview] = useState<{ source: Exclude<Busy, null>; trips: FoundTrip[]; note: string | null } | null>(null);

  function confirmDelete() {
    Alert.alert(
      "Delete your account?",
      `This permanently deletes your trips, saved places and taste profile for ${email ?? "this account"}. It can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteAccount() },
      ],
    );
  }

  async function deleteAccount() {
    setDeleting(true);
    setMsg(null);
    try {
      await api("/api/me", { method: "DELETE", json: { confirm: "delete" } });
      // The account is gone: drop it from this phone and carry on as a new guest.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setSummary(null);
      setMsg({ text: "Your account and everything in it has been deleted." });
      router.replace("/");
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setDeleting(false);
    }
  }

  const loadTaste = useCallback(() => {
    api<{ profile: { summary?: string } | null }>("/api/taste")
      .then((r) => setSummary(r.profile?.summary ?? null))
      .catch(() => {});
  }, []);
  useFocusEffect(loadTaste);

  // Rebuild the taste profile with what was found.
  const refreshTaste = useCallback(async () => {
    await api("/api/taste/refresh", { method: "POST" }).catch(() => {});
    loadTaste();
  }, [loadTaste]);

  async function run(kind: Exclude<Busy, null>) {
    setBusy(kind);
    setMsg(null);
    setProgress("");
    try {
      if (kind === "calendar") {
        const r = await scanCalendar(setProgress);
        const places = `${r.places} ${r.places === 1 ? "place" : "places"}`;
        if (r.trips.length) setReview({ source: kind, trips: r.trips, note: `The ${places} from your calendar (stays, restaurants and tours) are already saved to your taste.` });
        else {
          setMsg({ text: r.places ? `Found ${places} in your calendar, but no trips away to add.` : "No trips, hotel stays or reservations turned up in your calendar." });
          if (r.places) await refreshTaste();
        }
      } else {
        const r = await scanPhotos(setProgress);
        if (r.trips.length) setReview({ source: kind, trips: r.trips, note: r.limited ? LIMITED : null });
        else setMsg({ text: `We didn't find trips away from home in your photos.${r.limited ? ` ${LIMITED}` : ""}` });
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  async function saveReview(kept: FoundTrip[]) {
    const r = await saveTrips(kept);
    setReview(null);
    // A trip already there whose stay this scan found longer gets the longer count (`updated`).
    const there = r.skipped - r.updated;
    const fixed = r.updated ? ` Updated the days on ${r.updated} you'd added before.` : "";
    setMsg({
      text: r.added
        ? `Added ${r.added} ${r.added === 1 ? "trip" : "trips"} to Places you've been.${there > 0 ? ` ${there} ${there === 1 ? "was" : "were"} already there.` : ""}${fixed}`
        : `Those trips were already in Places you've been.${fixed}`,
    });
    await refreshTaste();
  }

  function skipReview() {
    const calendar = review?.source === "calendar";
    setReview(null);
    setMsg({ text: calendar ? "No trips added. The places from your calendar still help Pylos learn your taste." : "No trips added." });
    if (calendar) void refreshTaste();
  }

  return (
    <Screen>
      <Card>
        <H1>You</H1>
        <P muted>Let Pylos learn where you&apos;ve been and what you loved, so it can predict the hotels and restaurants you&apos;ll like next.</P>
        {summary ? <P>{summary}</P> : null}
      </Card>
      <RankEntryCard />
      <Card>
        <H2>Calendar on this phone</H2>
        <P muted>
          Past trips, hotel stays and restaurant reservations, including Resy and OpenTable bookings, from your iCloud, Google or Outlook calendars. Only the places it finds
          are saved.
        </P>
        <Button title={busy === "calendar" ? "Reading…" : "Allow and scan"} onPress={() => run("calendar")} disabled={!!busy || !!review} />
      </Card>
      <Card>
        <H2>Photos</H2>
        <P muted>Where and when your photos were taken shows the trips you&apos;ve been on. Your photos never leave your phone; only the cities and dates are saved.</P>
        <Button title={busy === "photos" ? "Looking…" : "Allow and scan"} onPress={() => run("photos")} disabled={!!busy || !!review} />
      </Card>
      {progress ? <Loading text={progress} /> : null}
      {review ? <TripReview key={`${review.source}-${review.trips.length}`} trips={review.trips} source={review.source} note={review.note} onSave={saveReview} onSkip={skipReview} /> : null}
      <Status text={msg?.text} err={msg?.err} />
      {email ? <AsksCard /> : null}
      <Card>
        <H2>Account</H2>
        {email ? (
          <>
            <P muted>Signed in as {email}</P>
            <Button ghost title="Sign out" disabled={deleting} onPress={() => void signOut()} />
            <Button ghost danger title={deleting ? "Deleting…" : "Delete account"} disabled={deleting || !!busy} onPress={confirmDelete} />
          </>
        ) : (
          <>
            <P muted>You&apos;re using Pylos as a guest. Sign in with your email to keep your trips on every device.</P>
            <Button ghost title="Sign in" onPress={() => router.push("/login")} />
          </>
        )}
      </Card>
    </Screen>
  );
}
