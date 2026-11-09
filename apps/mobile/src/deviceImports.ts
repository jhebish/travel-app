import { calendarSignals, dedupeSignals, nightOf, photoStays, sleepSpots, tripsFromSignals, type CalendarEventLike, type NightPoint, type PhotoPoint } from "@travel/core";
// The /legacy entry points keep the function-style APIs. From SDK 58 the main entry points are
// the new object APIs, and the old function names there throw at runtime.
import * as Calendar from "expo-calendar/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import { api } from "./api";

/**
 * "Grant permission" imports: the calendars and photos already on this phone. Everything is read
 * here; only the places, cities and dates Pylos finds are sent, never events or photos. The trips
 * found are shown for review first (TripReview.tsx); `saveTrips` adds the ones kept.
 */
export type Progress = (text: string) => void;

/** A trip a scan found: a city in a year, waiting for review before it goes into Places you've been. */
export interface FoundTrip {
  city: string;
  countryCode: string;
  year: number | null;
  month: number | null;
  days: number | null;
}

/** A hotel the photo scan thinks you stayed at (photos taken there at night), waiting for review. */
export interface FoundHotel {
  name: string;
  city: string | null;
  countryCode: string | null;
  /** The first night there (YYYY-MM-DD). */
  date: string;
  nights: number;
  placeId: string;
  lat: number;
  lng: number;
}

/** Add the hotels kept after review to Places you've stayed (taste signals; re-saving one is a no-op). */
export async function saveHotels(hotels: FoundHotel[]): Promise<{ added: number }> {
  if (!hotels.length) return { added: 0 };
  const signals = hotels.map((h) => ({
    source: "photos",
    ref: `photos:${h.placeId}:${h.date.slice(0, 7)}`,
    kind: "stay",
    name: h.name,
    city: h.city,
    countryCode: h.countryCode,
    lat: h.lat,
    lng: h.lng,
    date: h.date,
    note: `${h.nights} ${h.nights === 1 ? "night" : "nights"}, from your photos`,
  }));
  const r = await api<{ added: number }>("/api/taste/signals", { method: "POST", json: { signals } });
  return { added: r.added };
}

/**
 * Add the trips kept after review to Places you've been. Ones already logged are skipped, except
 * that a longer stay found now corrects a shorter one logged before (`updated`).
 */
export async function saveTrips(trips: FoundTrip[]): Promise<{ added: number; skipped: number; updated: number }> {
  let added = 0;
  let skipped = 0;
  let updated = 0;
  for (let i = 0; i < trips.length; i += 100) {
    const r = await api<{ added: number; skipped: number; updated?: number }>("/api/community/places/bulk", { method: "POST", json: { places: trips.slice(i, i + 100) } });
    added += r.added;
    skipped += r.skipped;
    updated += r.updated ?? 0;
  }
  return { added, skipped, updated };
}

const YEARS_BACK = 6;
/** Photos looked at per day until one has a location. */
const PER_DAY = 6;
const DAY_MS = 864e5;
const pad = (n: number) => String(n).padStart(2, "0");
/** The day on this phone's clock (all-day events and photo days). */
const localDay = (d: Date | number | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const toIso = (d: Date | string) => new Date(d).toISOString();

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

// ---------------------------------------------------------------------------
// Calendar: trips, hotel stays and restaurant reservations
// ---------------------------------------------------------------------------
/** Saves the places found to your taste; the trips come back for review (`saveTrips`). */
export async function scanCalendar(progress: Progress): Promise<{ places: number; trips: FoundTrip[] }> {
  const perm = await Calendar.requestCalendarPermissionsAsync();
  if (!perm.granted) throw new Error("Calendar access is off. Turn it on for Pylos in Settings to scan.");
  progress("Reading your calendars…");
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const ids = calendars.map((c) => c.id);
  if (!ids.length) return { places: 0, trips: [] };

  const events: CalendarEventLike[] = [];
  const now = Date.now();
  const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // iOS reads at most four years per query, so go a year at a time.
  for (let y = 0; y < YEARS_BACK; y++) {
    const end = new Date(now - y * 365 * DAY_MS);
    const start = new Date(now - (y + 1) * 365 * DAY_MS);
    progress(`Reading your calendars… ${start.getFullYear()}`);
    const batch = await Calendar.getEventsAsync(ids, start, end).catch(() => []);
    for (const e of batch) {
      events.push({
        id: e.id,
        summary: e.title ?? "",
        location: e.location ?? "",
        description: (e.notes ?? "").slice(0, 2000),
        start: e.allDay ? localDay(e.startDate) : toIso(e.startDate),
        end: e.allDay ? localDay(e.endDate) : toIso(e.endDate),
        // Phones give UTC times: read them in the event's zone so an 8pm dinner keeps its date.
        timeZone: e.timeZone || phoneZone,
        // Weekly meetings, birthdays and other repeats aren't trips or bookings.
        recurring: !!e.recurrenceRule,
      });
    }
  }

  const visits = calendarSignals(events, "ics");
  const signals = dedupeSignals(visits);
  if (!signals.length) return { places: 0, trips: [] };
  progress(`Saving ${signals.length} places…`);
  for (let i = 0; i < signals.length; i += 1000) {
    await api("/api/taste/signals", { method: "POST", json: { signals: signals.slice(i, i + 1000) } });
  }
  // Trips come from every visit, not one per place, so Lisbon in 2022 and again in 2024 are two.
  const trips = tripsFromSignals(visits).map(({ city, countryCode, year, month, days }) => ({ city, countryCode, year, month, days }));
  return { places: signals.length, trips };
}

// ---------------------------------------------------------------------------
// Photos: where and when they were taken shows the trips you've been on
// ---------------------------------------------------------------------------
/**
 * Where you slept on each trip: the spots where photos were taken late in the evening and early in
 * the morning, read only for the days of trips already found. `i` is the stay's index.
 */
async function nightSpotsFor(stays: { lat: number; lng: number; start: string; end: string }[], progress: Progress) {
  const spots: { i: number; lat: number; lng: number; first: string; nights: number }[] = [];
  let done = 0;
  // The 80 most recent trips, newest first: a long history would otherwise take minutes to read.
  const order = stays
    .map((s, i) => ({ s, i }))
    .reverse()
    .slice(0, 80);
  await pool(order, 4, async ({ s, i }) => {
    if (spots.length >= 60) return;
    // Phone days can be a day off the place's own dates, so look a little either side.
    const from = Date.parse(`${s.start}T00:00:00Z`) - 36 * 36e5;
    const to = Date.parse(`${s.end}T00:00:00Z`) + 60 * 36e5;
    const nights = new Map<string, { a: MediaLibrary.Asset; when: "evening" | "morning"; at: number }[]>();
    let after: string | undefined;
    for (let page = 0; page < 4; page++) {
      const r = await MediaLibrary.getAssetsAsync({ first: 200, after, mediaType: MediaLibrary.MediaType.photo, sortBy: [[MediaLibrary.SortBy.creationTime, true]], createdAfter: from, createdBefore: to }).catch(() => null);
      if (!r) break;
      for (const a of r.assets) {
        if (a.mediaSubtypes?.includes("screenshot")) continue;
        const n = nightOf(a.creationTime, s.lng);
        if (!n || n.night < addDay(s.start, -1) || n.night > s.end) continue;
        nights.set(n.night, [...(nights.get(n.night) ?? []), { a, when: n.when, at: a.creationTime }]);
      }
      if (!r.hasNextPage) break;
      after = r.endCursor;
    }
    // Each night: the latest evening photos and the earliest morning ones, until two have a location.
    const points: NightPoint[] = [];
    for (const [night, list] of nights) {
      const evening = list.filter((x) => x.when === "evening").sort((a, b) => b.at - a.at).slice(0, 2);
      const morning = list.filter((x) => x.when === "morning").sort((a, b) => a.at - b.at).slice(0, 2);
      let located = 0;
      for (const x of [...evening, ...morning]) {
        if (located >= 2) break;
        const info = await MediaLibrary.getAssetInfoAsync(x.a, { shouldDownloadFromNetwork: false }).catch(() => null);
        const loc = info?.location;
        if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && (loc.latitude !== 0 || loc.longitude !== 0)) {
          points.push({ night, lat: loc.latitude, lng: loc.longitude, when: x.when });
          located++;
        }
      }
    }
    for (const sp of sleepSpots(points)) if (spots.length < 60) spots.push({ i, ...sp });
    done++;
    if (done % 5 === 0) progress(`Finding the hotels you stayed at… ${Math.round((done / order.length) * 100)}%`);
  });
  return spots;
}
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The trips your photos show, named by the server but not saved: they come back for review
 * (`saveTrips`). With `hotels`, also the hotels where you took photos at night on those trips
 * (`saveHotels`): those spots are looked up on Google Maps by the server and not kept.
 */
export async function scanPhotos(progress: Progress, opts: { hotels?: boolean } = {}): Promise<{ trips: FoundTrip[]; hotels: FoundHotel[]; limited: boolean }> {
  const perm = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
  if (!perm.granted) throw new Error("Photo access is off. Turn it on for Pylos in Settings to scan.");
  const limited = perm.accessPrivileges === "limited";

  // A few photos per day, newest first, skipping screenshots: most of a day's pictures carry no
  // location (saved images, screenshots), so two weren't enough to place a trip's middle days.
  const since = Date.now() - YEARS_BACK * 365 * DAY_MS;
  const byDay = new Map<string, MediaLibrary.Asset[]>();
  let after: string | undefined;
  for (let page = 0; page < 200; page++) {
    const r = await MediaLibrary.getAssetsAsync({
      first: 500,
      after,
      mediaType: MediaLibrary.MediaType.photo,
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      createdAfter: since,
    });
    for (const a of r.assets) {
      if (a.mediaSubtypes?.includes("screenshot")) continue;
      const k = localDay(a.creationTime);
      const list = byDay.get(k);
      if (!list) byDay.set(k, [a]);
      else if (list.length < PER_DAY) list.push(a);
    }
    progress(`Looking through your photos… ${byDay.size} days`);
    if (!r.hasNextPage) break;
    after = r.endCursor;
  }

  // Where you were each day, from the photo's location. Photos stay on the phone.
  const days = [...byDay.entries()];
  const points: PhotoPoint[] = [];
  let done = 0;
  await pool(days, 8, async ([day, assets]) => {
    for (const a of assets) {
      const info = await MediaLibrary.getAssetInfoAsync(a, { shouldDownloadFromNetwork: false }).catch(() => null);
      const loc = info?.location;
      if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && (loc.latitude !== 0 || loc.longitude !== 0)) {
        points.push({ day, lat: loc.latitude, lng: loc.longitude });
        break;
      }
    }
    done++;
    if (done % 40 === 0) progress(`Finding where you were… ${Math.round((done / days.length) * 100)}%`);
  });
  if (points.length < 3) return { trips: [], hotels: [], limited };

  const stays = photoStays(points).slice(-300);
  if (!stays.length) return { trips: [], hotels: [], limited };
  const spots = opts.hotels ? await nightSpotsFor(stays, progress) : [];
  progress(`Naming ${stays.length} places…`);
  // Rough centres and dates, and (for hotels) the night-time spots; `preview` saves nothing.
  const r = await api<{ trips: FoundTrip[]; hotels?: FoundHotel[] }>("/api/taste/photo-trips", { method: "POST", json: { stays, preview: true, ...(spots.length ? { spots } : {}) } });
  return { trips: r.trips, hotels: r.hotels ?? [], limited };
}
