import { calendarSignals, dedupeSignals, photoStays, tripsFromSignals, type CalendarEventLike, type PhotoPoint } from "@travel/core";
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

/** Add the trips kept after review to Places you've been. Ones already logged are skipped. */
export async function saveTrips(trips: FoundTrip[]): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < trips.length; i += 100) {
    const r = await api<{ added: number; skipped: number }>("/api/community/places/bulk", { method: "POST", json: { places: trips.slice(i, i + 100) } });
    added += r.added;
    skipped += r.skipped;
  }
  return { added, skipped };
}

const YEARS_BACK = 6;
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
/** The trips your photos show, named by the server but not saved: they come back for review (`saveTrips`). */
export async function scanPhotos(progress: Progress): Promise<{ trips: FoundTrip[]; limited: boolean }> {
  const perm = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
  if (!perm.granted) throw new Error("Photo access is off. Turn it on for Pylos in Settings to scan.");
  const limited = perm.accessPrivileges === "limited";

  // One or two photos per day, newest first.
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
      const k = localDay(a.creationTime);
      const list = byDay.get(k) ?? [];
      if (list.length < 2) byDay.set(k, [...list, a]);
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
  if (points.length < 3) return { trips: [], limited };

  const stays = photoStays(points).slice(-300);
  if (!stays.length) return { trips: [], limited };
  progress(`Naming ${stays.length} places…`);
  // Still only rough centres and dates; `preview` names them without saving anything.
  const r = await api<{ trips: FoundTrip[] }>("/api/taste/photo-trips", { method: "POST", json: { stays, preview: true } });
  return { trips: r.trips, limited };
}
