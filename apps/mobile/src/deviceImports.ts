import { calendarSignals, dedupeSignals, photoStays, tripsFromSignals, type CalendarEventLike, type PhotoPoint } from "@travel/core";
import * as Calendar from "expo-calendar";
import * as MediaLibrary from "expo-media-library";
import { api } from "./api";

/**
 * "Grant permission" imports: the calendars and photos already on this phone. Everything is read
 * here; only the places, cities and dates Pylos finds are sent, never events or photos.
 */
export type Progress = (text: string) => void;

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
export async function scanCalendar(progress: Progress): Promise<{ places: number; trips: number }> {
  const perm = await Calendar.requestCalendarPermissionsAsync();
  if (!perm.granted) throw new Error("Calendar access is off. Turn it on for Pylos in Settings to scan.");
  progress("Reading your calendars…");
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const ids = calendars.map((c) => c.id);
  if (!ids.length) return { places: 0, trips: 0 };

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

  const signals = dedupeSignals(calendarSignals(events, "ics"));
  if (!signals.length) return { places: 0, trips: 0 };
  progress(`Saving ${signals.length} places…`);
  for (let i = 0; i < signals.length; i += 1000) {
    await api("/api/taste/signals", { method: "POST", json: { signals: signals.slice(i, i + 1000) } });
  }
  const trips = tripsFromSignals(signals);
  const added = trips.length ? (await api<{ added: number }>("/api/community/places/bulk", { method: "POST", json: { places: trips } })).added : 0;
  return { places: signals.length, trips: added };
}

// ---------------------------------------------------------------------------
// Photos: where and when they were taken shows the trips you've been on
// ---------------------------------------------------------------------------
export interface PhotoTrip {
  city: string;
  countryCode: string;
  year: number | null;
}

export async function scanPhotos(progress: Progress): Promise<{ added: number; trips: PhotoTrip[]; limited: boolean }> {
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
  if (points.length < 3) return { added: 0, trips: [], limited };

  const stays = photoStays(points).slice(-300);
  if (!stays.length) return { added: 0, trips: [], limited };
  progress(`Naming ${stays.length} places…`);
  const r = await api<{ added: number; trips: PhotoTrip[] }>("/api/taste/photo-trips", { method: "POST", json: { stays } });
  return { added: r.added, trips: r.trips, limited };
}
