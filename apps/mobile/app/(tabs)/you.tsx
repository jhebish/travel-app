import type { PastStay } from "@travel/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Switch, View } from "react-native";
import { api } from "../../src/api";
import { AsksCard } from "../../src/AsksCard";
import { useAuth } from "../../src/auth";
import { saveHotels, saveTrips, scanCalendar, scanPhotos, type FoundHotel, type FoundTrip } from "../../src/deviceImports";
import { signOut } from "../../src/notifications";
import { RankEntryCard } from "../../src/RankCards";
import { StaysCard } from "../../src/Stays";
import { supabase } from "../../src/supabase";
import { TasteInsights, type ForYou, type TasteResponse } from "../../src/TasteInsights";
import { useTheme } from "../../src/theme";
import { TripReview } from "../../src/TripReview";
import { YourPicksCard } from "../../src/YourPicks";
import { Button, Card, H1, H2, Loading, P, Screen, Status, Text } from "../../src/ui";

type Busy = null | "calendar" | "photos";
const LIMITED = "You shared only some photos; allow all photos in Settings for a full scan.";

/** Teach Pylos your taste by allowing the calendar and photos already on this phone, and see what it learned. */
export default function You() {
  const t = useTheme();
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [taste, setTaste] = useState<TasteResponse | null>(null);
  const [updating, setUpdating] = useState(false);
  // The scan that just finished, so the insights say where they came from.
  const [fresh, setFresh] = useState<Exclude<Busy, null> | null>(null);
  const [forYou, setForYou] = useState<ForYou | null>(null);
  const [stays, setStays] = useState<PastStay[] | null>(null);
  const [findHotels, setFindHotels] = useState(true);
  const { session } = useAuth();
  const router = useRouter();
  const email = session?.user && !session.user.is_anonymous ? session.user.email : undefined;
  const [deleting, setDeleting] = useState(false);
  // What a scan found, waiting for the person to check it before it's added.
  const [review, setReview] = useState<{ source: Exclude<Busy, null>; trips: FoundTrip[]; hotels: FoundHotel[]; note: string | null } | null>(null);
  const refreshed = useRef(false);

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
      setTaste(null);
      setStays(null);
      setMsg({ text: "Your account and everything in it has been deleted." });
      router.replace("/");
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setDeleting(false);
    }
  }

  const loadTaste = useCallback(async () => {
    const [r] = await Promise.all([
      api<TasteResponse>("/api/taste").catch(() => null),
      api<{ stays: PastStay[] }>("/api/taste/stays")
        .then((x) => setStays(x.stays))
        .catch(() => {}),
      api<ForYou>("/api/browse/foryou")
        .then(setForYou)
        .catch(() => {}),
    ]);
    if (r) setTaste(r);
    return r;
  }, []);

  // Rebuild the taste profile with what's new (a model call, only when something changed).
  const refreshTaste = useCallback(async () => {
    setUpdating(true);
    try {
      await api("/api/taste/refresh", { method: "POST" }).catch(() => {});
      await loadTaste();
    } finally {
      setUpdating(false);
    }
  }, [loadTaste]);

  useFocusEffect(
    useCallback(() => {
      void loadTaste().then((r) => {
        // Out of date (places added on the site, say): bring it up to date once per visit.
        if (r?.stale && !refreshed.current) {
          refreshed.current = true;
          void refreshTaste();
        }
      });
      return () => {
        refreshed.current = false;
      };
    }, [loadTaste, refreshTaste]),
  );

  async function run(kind: Exclude<Busy, null>) {
    setBusy(kind);
    setMsg(null);
    setProgress("");
    try {
      if (kind === "calendar") {
        const r = await scanCalendar(setProgress);
        const places = `${r.places} ${r.places === 1 ? "place" : "places"}`;
        if (r.trips.length) setReview({ source: kind, trips: r.trips, hotels: [], note: `The ${places} from your calendar (stays, restaurants and tours) are already saved to your taste.` });
        else {
          setMsg({ text: r.places ? `Found ${places} in your calendar, but no trips away to add.` : "No trips, hotel stays or reservations turned up in your calendar." });
          if (r.places) {
            setFresh("calendar");
            await refreshTaste();
          }
        }
      } else {
        const r = await scanPhotos(setProgress, { hotels: findHotels });
        if (r.trips.length || r.hotels.length) setReview({ source: kind, trips: r.trips, hotels: r.hotels, note: r.limited ? LIMITED : null });
        else setMsg({ text: `We didn't find trips away from home in your photos.${r.limited ? ` ${LIMITED}` : ""}` });
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  async function saveReview(kept: FoundTrip[], keptHotels: FoundHotel[]) {
    const source = review?.source ?? "photos";
    const [r, h] = await Promise.all([kept.length ? saveTrips(kept) : Promise.resolve({ added: 0, skipped: 0, updated: 0 }), saveHotels(keptHotels)]);
    setReview(null);
    // A trip already there whose stay this scan found longer gets the longer count (`updated`).
    const there = r.skipped - r.updated;
    const parts = [
      r.added ? `Added ${r.added} ${r.added === 1 ? "trip" : "trips"} to Places you've been.` : kept.length ? "Those trips were already in Places you've been." : "",
      r.added && there > 0 ? `${there} ${there === 1 ? "was" : "were"} already there.` : "",
      r.updated ? `Updated the days on ${r.updated} you'd added before.` : "",
      keptHotels.length ? (h.added ? `Added ${h.added} ${h.added === 1 ? "hotel" : "hotels"} to Places you've stayed.` : "Those hotels were already in Places you've stayed.") : "",
    ].filter(Boolean);
    setMsg({ text: `${parts.join(" ")} Here's what Pylos learned.` });
    setFresh(source);
    await refreshTaste();
  }

  function skipReview() {
    const calendar = review?.source === "calendar";
    setReview(null);
    setMsg({ text: calendar ? "No trips added. The places from your calendar still help Pylos learn your taste." : "No trips added." });
    if (calendar) {
      setFresh("calendar");
      void refreshTaste();
    }
  }

  const insights = <TasteInsights data={taste} updating={updating} fresh={fresh} forYou={forYou} />;
  const trips = taste?.counts.pastTrips ?? 0;

  return (
    <Screen>
      <Card>
        <H1>You</H1>
        <P muted>Let Pylos learn where you&apos;ve been and what you loved, so it can predict the hotels and restaurants you&apos;ll like next.</P>
      </Card>
      {/* What Pylos learned sits at the top; right after a scan it shows where the review was, below. */}
      {fresh ? null : insights}
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
        <P muted>
          Where and when your photos were taken shows the trips you&apos;ve been on. Your photos never leave your phone; only the cities and dates are saved.
        </P>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, backgroundColor: t.bg, borderRadius: 12, padding: 12 }}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>Find the hotels too</Text>
            <Text style={{ color: t.muted, fontSize: 14 }}>
              The spots where you took photos at night on trips are looked up on Google Maps for the hotel there, then discarded. You check each hotel before it&apos;s saved.
            </Text>
          </View>
          <Switch accessibilityLabel="Find the hotels too" value={findHotels} onValueChange={setFindHotels} disabled={!!busy} />
        </View>
        <Button title={busy === "photos" ? "Looking…" : "Allow and scan"} onPress={() => run("photos")} disabled={!!busy || !!review} />
      </Card>
      {progress ? <Loading text={progress} /> : null}
      {review ? (
        <TripReview
          key={`${review.source}-${review.trips.length}-${review.hotels.length}`}
          trips={review.trips}
          hotels={review.hotels}
          source={review.source}
          note={review.note}
          onSave={saveReview}
          onSkip={skipReview}
        />
      ) : null}
      <Status text={msg?.text} err={msg?.err} />
      {fresh ? insights : null}
      <StaysCard stays={stays} />
      <Card>
        <H2>Places you&apos;ve been</H2>
        <P muted>
          {trips ? `${trips} ${trips === 1 ? "trip" : "trips"} so far. Rate the ones you loved most: they weigh most in your taste.` : "Every trip you log or a scan finds, by year."}
        </P>
        <Button ghost title={trips ? "See them on the map" : "Open"} onPress={() => router.push("/places")} />
      </Card>
      {email ? <YourPicksCard /> : null}
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
