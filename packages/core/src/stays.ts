/**
 * Booking somewhere to stay outside Pylos: where and when, per city on the trip, and the Airbnb
 * search for it. Airbnb has no public search API, so this is a link that opens Airbnb's own search
 * with the place, the dates and the guests filled in (checked by hand on airbnb.com, Nov 2026).
 *
 * No zod here: the web and phone apps use it in the browser.
 */
import type { Itinerary, TripRequest } from "./schemas";

/** One stay to book: a city and, when the trip has dates, the nights there. */
export interface StayWindow {
  /** What to search for. On a multi-city trip, the town with its country: "Luxor, Egypt". */
  place: string;
  /** The town, for labels. */
  city: string;
  /** YYYY-MM-DD, only when the trip has a start date that hasn't passed. */
  checkin?: string;
  checkout?: string;
  nights: number;
}

export interface Guests {
  adults: number;
  children: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Today in UTC (YYYY-MM-DD). */
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Where the traveler sleeps, in order: the whole trip in one place, or each run of days in the same
 * town on a multi-city trip (a town visited twice is two stays). A day's night is spent where the
 * day is, so the nights in a place are its days, and you check out the morning you move on.
 * Dates come from the trip's start date (or `startDate`), dropped if it's already past.
 */
export function stayWindows(
  trip: { destination: string; request: Pick<TripRequest, "startDate"> & Partial<Pick<TripRequest, "mode">>; itinerary: Pick<Itinerary, "days" | "mode"> },
  opts: { startDate?: string | null; today?: string } = {},
): StayWindow[] {
  const raw = opts.startDate ?? trip.request.startDate ?? null;
  const start = raw && ISO.test(raw) && raw >= (opts.today ?? todayIso()) ? raw : null;
  const dates = (from: number, nights: number) => (start ? { checkin: plusDays(start, from), checkout: plusDays(start, from + nights) } : {});
  const days = trip.itinerary.days;
  const whole = (): StayWindow[] => [{ place: trip.destination, city: trip.destination, nights: Math.max(1, days.length), ...dates(0, Math.max(1, days.length)) }];

  const multi = (trip.itinerary.mode ?? trip.request.mode) === "multi";
  if (!multi || !days.some((d) => d.city?.trim())) return whole();

  const runs: { city: string; from: number; nights: number }[] = [];
  days.forEach((d, i) => {
    const city = d.city?.trim() || runs[runs.length - 1]?.city || trip.destination;
    const last = runs[runs.length - 1];
    if (last && last.city.toLowerCase() === city.toLowerCase()) last.nights++;
    else runs.push({ city, from: i, nights: 1 });
  });
  const region = trip.destination.trim();
  return runs.map((r) => ({
    place: r.city.toLowerCase() === region.toLowerCase() ? r.city : `${r.city}, ${region}`,
    city: r.city,
    nights: r.nights,
    ...dates(r.from, r.nights),
  }));
}

/**
 * Who's staying. Families are counted as two adults and two children (Airbnb needs a number to show
 * places big enough; they can change it there). Friends planning the trip together count too.
 */
export function guestsFor(req: Pick<TripRequest, "party"> & Partial<Pick<TripRequest, "with">>): Guests {
  const base = req.party === "Solo" ? 1 : req.party === "Group of friends" ? 4 : 2;
  const adults = Math.min(16, Math.max(base, 1 + (req.with?.length ?? 0)));
  const children = req.party === "Family with kids" ? Math.min(2, 16 - adults) : 0;
  return { adults, children };
}

export const guestsText = (g: Guests) =>
  g.children ? `${g.adults} adults, ${g.children} kids` : `${g.adults} ${g.adults === 1 ? "guest" : "guests"}`;

/** "Dec 4–7", or "Nov 29 – Dec 2" across months. */
export function dateSpan(checkin: string, checkout: string): string {
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  const sameMonth = checkin.slice(0, 7) === checkout.slice(0, 7);
  return sameMonth
    ? `${fmt(checkin, { month: "short", day: "numeric" })}–${fmt(checkout, { day: "numeric" })}`
    : `${fmt(checkin, { month: "short", day: "numeric" })} – ${fmt(checkout, { month: "short", day: "numeric" })}`;
}

/**
 * Airbnb's search for a stay. The place goes in the path the way Airbnb writes it ("Luxor--Egypt":
 * a comma becomes "--", a space "-"), since an encoded comma throws off its place lookup.
 */
export function airbnbSearchUrl(w: Pick<StayWindow, "place" | "checkin" | "checkout">, g: Guests): string {
  const slug = w.place
    .replace(/(^|,)\s*the\s+/gi, "$1")
    .replace(/[/\\?#%]+/g, " ")
    .trim()
    .replace(/\s*,\s*/g, "--")
    .replace(/\s+/g, "-");
  const q = new URLSearchParams();
  if (w.checkin && w.checkout) {
    q.set("checkin", w.checkin);
    q.set("checkout", w.checkout);
  }
  q.set("adults", String(g.adults));
  if (g.children) q.set("children", String(g.children));
  return `https://www.airbnb.com/s/${encodeURIComponent(slug)}/homes?${q}`;
}

/**
 * Airbnb's own icon, loaded from Airbnb (not copied into the app): the sharper PNG its pages list,
 * then the favicon at the site's root if that one ever moves. Shown as a link's icon only.
 */
export const AIRBNB_ICONS = [
  "https://a0.muscache.com/im/pictures/AirbnbPlatformAssets/AirbnbPlatformAssets-Favicons/original/d1fcc0b3-865f-485a-b28b-43ca0bf7c891.png?im_w=240",
  "https://www.airbnb.com/favicon.ico",
] as const;
