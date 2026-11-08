/**
 * Payback for logging trips: your year in travel, "a year ago you were in Kyoto", and the taste
 * profile that unlocks after a few trips. Plain functions with no zod, for the server and the browser.
 */
import type { SignalKind } from "./labels";
import { pastTripIsOver, todayEverywhere } from "./privacy";
import { cityKey } from "./stats";
import type { TasteProfileCore } from "./taste";

export interface RecapTrip {
  id: string;
  city: string;
  countryCode: string;
  year: number | null;
  month: number | null;
  days: number | null;
  rating: number | null;
  /** The owner's own ranking ("Which did you love more?"); higher is better, null until compared. */
  rankScore?: number | null;
}

export interface RecapSignal {
  pastTripId: string | null;
  kind: SignalKind;
  name: string;
  city?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  rating?: number | null;
  liked?: boolean | null;
  rankScore?: number | null;
}

export interface YearRecap {
  year: number;
  trips: number;
  cities: number;
  countries: number;
  /** Countries first visited this year (codes), in the order of the trips. */
  newCountries: string[];
  /** Days away on the trips that have a length logged; `daysUnknown` trips don't. */
  daysAway: number;
  daysUnknown: number;
  topCity: { city: string; countryCode: string; pastTripId: string } | null;
  topPlace: { name: string; kind: SignalKind; city: string | null } | null;
}

/** Higher first, with unknowns last. */
const desc = (a: number | null | undefined, b: number | null | undefined) => (b ?? -Infinity) - (a ?? -Infinity) || 0;

/** Did they love this place? An explicit like, four stars or more, or a place in their own ranking. */
const loved = (s: Pick<RecapSignal, "liked" | "rating" | "rankScore">) => s.liked !== false && (s.liked === true || (s.rating ?? 0) >= 4 || s.rankScore != null);

/** Best first: their own ranking, then stars, then a like. */
export const byLoved = <T extends Pick<RecapSignal, "liked" | "rating" | "rankScore">>(a: T, b: T) =>
  desc(a.rankScore, b.rankScore) || desc(a.rating, b.rating) || Number(b.liked === true) - Number(a.liked === true);

/**
 * Someone's year in travel, from their own past trips and places. Only trips that are over count
 * (an import can include ones still ahead), and so only places from those trips, or dated places
 * already behind them.
 */
export function yearRecap(trips: RecapTrip[], signals: RecapSignal[], year: number, now: Date | number = Date.now()): YearRecap {
  const done = trips.filter((t) => pastTripIsOver(t, now));
  const inYear = done.filter((t) => t.year === year).sort((a, b) => (a.month ?? 13) - (b.month ?? 13) || a.city.localeCompare(b.city));
  // Trips with no year might be from any time, so their countries don't count as new.
  const before = new Set(done.filter((t) => t.year == null || t.year < year).map((t) => t.countryCode.toUpperCase()));
  const countries = [...new Set(inYear.map((t) => t.countryCode.toUpperCase()))];
  const cities = new Set(inYear.map((t) => `${t.countryCode.toUpperCase()}:${cityKey(t.city)}`));

  const ids = new Set(inYear.map((t) => t.id));
  const today = todayEverywhere(now);
  const places = signals.filter(
    (s) =>
      s.kind !== "city" &&
      loved(s) &&
      (s.pastTripId ? ids.has(s.pastTripId) : !!s.date && s.date.startsWith(`${year}-`) && s.date <= today),
  );
  const lovedOn = new Map<string, number>();
  for (const s of places) if (s.pastTripId) lovedOn.set(s.pastTripId, (lovedOn.get(s.pastTripId) ?? 0) + 1);

  const top = [...inYear].sort(
    (a, b) => desc(a.rankScore, b.rankScore) || desc(a.rating, b.rating) || desc(lovedOn.get(a.id), lovedOn.get(b.id)) || desc(a.days, b.days),
  )[0];
  const place = [...places].sort(byLoved)[0];

  return {
    year,
    trips: inYear.length,
    cities: cities.size,
    countries: countries.length,
    newCountries: countries.filter((c) => !before.has(c)),
    daysAway: inYear.reduce((n, t) => n + (t.days ?? 0), 0),
    daysUnknown: inYear.filter((t) => !t.days).length,
    topCity: top ? { city: top.city, countryCode: top.countryCode.toUpperCase(), pastTripId: top.id } : null,
    topPlace: place ? { name: place.name, kind: place.kind, city: place.city ?? null } : null,
  };
}

/** The years someone has trips in (over ones), newest first. */
export function recapYears(trips: Pick<RecapTrip, "year" | "month">[], now: Date | number = Date.now()): number[] {
  return [...new Set(trips.filter((t) => t.year != null && pastTripIsOver(t, now)).map((t) => t.year!))].sort((a, b) => b - a);
}

/** One line on how someone travels, from their taste profile: its first sentence, else a few traits. */
export function travelPersonality(p: Pick<TasteProfileCore, "summary" | "stays" | "food" | "activities"> | null | undefined): string | null {
  if (!p) return null;
  const summary = (p.summary ?? "").replace(/\s+/g, " ").trim();
  const first = summary.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? summary;
  if (first) return first.length <= 140 ? first : `${first.slice(0, 139).replace(/[\s,;:.]+\S*$/, "")}…`;
  const traits = [p.stays?.styles?.[0], p.food?.vibes?.[0] ?? p.food?.cuisines?.[0], p.activities?.[0]].filter((x): x is string => !!x?.trim());
  if (!traits.length) return null;
  const [head, ...rest] = traits.map((t) => t.trim());
  return [head!.charAt(0).toUpperCase() + head!.slice(1), ...rest.map((t) => t.toLowerCase())].join(" · ");
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------
export interface Today {
  year: number;
  /** 1–12 */
  month: number;
}

/** Past trips from this month in earlier years, most recent first. */
export function memoriesFor<T extends { year: number | null; month: number | null }>(trips: T[], today: Today): T[] {
  return trips.filter((t) => t.year != null && t.year < today.year && t.month === today.month).sort((a, b) => b.year! - a.year!);
}

const NUMBER_WORDS = ["", "A", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "A year ago you were in Kyoto", "Three years ago you were in Lisbon". */
export function memoryLine(t: { city: string; year: number }, today: Today): string {
  const n = Math.max(1, today.year - t.year);
  return `${n === 1 ? "A year" : `${NUMBER_WORDS[n] ?? n} years`} ago you were in ${t.city}`;
}

// ---------------------------------------------------------------------------
// Taste profile unlock
// ---------------------------------------------------------------------------
export const TASTE_UNLOCK_TRIPS = 3;

/** The taste profile shows once someone has logged a few trips; until then, how far along they are. */
export function tasteUnlock(tripsLogged: number): { unlocked: boolean; have: number; need: number } {
  const have = Math.max(0, Math.floor(Number(tripsLogged) || 0));
  return { unlocked: have >= TASTE_UNLOCK_TRIPS, have: Math.min(have, TASTE_UNLOCK_TRIPS), need: TASTE_UNLOCK_TRIPS };
}
