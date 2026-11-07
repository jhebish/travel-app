import { z } from "zod";
import { isCountryCode } from "./countries";
import { cityKey, travelStats, TRAVEL_LEVELS, type TravelLevel, type TravelStats } from "./stats";
export { cityKey, travelStats, TRAVEL_LEVELS, type TravelLevel, type TravelStats } from "./stats";
import type { ABOUT_OPTIONS } from "./labels";
import type { Itinerary } from "./schemas";
import type { TasteSignal } from "./taste";

export const VISIBILITIES = ["private", "followers", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VisibilitySchema = z.enum(VISIBILITIES);
export const VISIBILITY_LABELS: Record<Visibility, string> = { private: "Only me", followers: "Followers", public: "Everyone" };


/** Title-case a city key for display when we have nothing better. */
export const cityLabel = (key: string) => key.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const RESERVED = new Set(["admin", "pylos", "ayoush", "support", "help", "me", "settings", "community", "official", "staff", "null", "undefined"]);

export const CommunityProfileInputSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE_RE, "3–24 letters, numbers or underscores")
    .refine((h) => !RESERVED.has(h), "That handle is reserved"),
  displayName: z.string().trim().min(1).max(60),
  homeCity: z.string().trim().max(80).default(""),
  bio: z.string().trim().max(280).default(""),
  defaultVisibility: VisibilitySchema.default("followers"),
  placesPublic: z.boolean().default(false),
});
export type CommunityProfileInput = z.infer<typeof CommunityProfileInputSchema>;

const thisYear = () => new Date().getUTCFullYear();
export const PastTripInputSchema = z.object({
  city: z.string().trim().min(1).max(80),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isCountryCode, "Pick a country from the list"),
  year: z
    .number()
    .int()
    .min(1950)
    .refine((y) => y <= thisYear() + 1, "That year hasn't happened yet")
    .nullable()
    .default(null),
  month: z.number().int().min(1).max(12).nullable().default(null),
  days: z.number().int().min(1).max(365).nullable().default(null),
  rating: z.number().int().min(1).max(5).nullable().default(null),
  highlights: z.string().trim().max(500).default(""),
  tripId: z.string().uuid().nullable().default(null),
});
export type PastTripInput = z.infer<typeof PastTripInputSchema>;

/**
 * The trips (a city in a year) implied by places someone has been: a flight into Lisbon, a hotel
 * night in Kyoto, a dinner in Paris. For "Places you've been" after a calendar or account import.
 */
export function tripsFromSignals(signals: Pick<TasteSignal, "kind" | "name" | "city" | "countryCode" | "date">[], max = 100): PastTripInput[] {
  const by = new Map<string, PastTripInput>();
  for (const s of signals) {
    const city = (s.kind === "city" ? s.name : s.city)?.trim();
    if (!city || !s.countryCode || !isCountryCode(s.countryCode) || !s.date) continue;
    const year = Number(s.date.slice(0, 4));
    if (!(year >= 1950 && year <= new Date().getUTCFullYear() + 1)) continue;
    const month = Number(s.date.slice(5, 7));
    const key = `${cityKey(city)}|${year}`;
    if (!by.has(key)) {
      by.set(key, { city: city.slice(0, 80), countryCode: s.countryCode.toUpperCase(), year, month: month >= 1 && month <= 12 ? month : null, days: null, rating: null, highlights: "", tripId: null });
    }
  }
  return [...by.values()].slice(0, max);
}

export interface PastTrip {
  id: string;
  city: string;
  countryCode: string;
  year: number | null;
  month: number | null;
  days: number | null;
  rating: number | null;
  highlights: string;
  tripId: string | null;
}





/** Most-travelled first: countries, then cities, then trips logged. */
export function rankTravellers<T extends { stats: Pick<TravelStats, "countries" | "cities" | "trips"> }>(people: T[]): (T & { rank: number })[] {
  const sorted = [...people].sort(
    (a, b) => b.stats.countries - a.stats.countries || b.stats.cities - a.stats.cities || b.stats.trips - a.stats.trips,
  );
  let rank = 0;
  let prev: T | undefined;
  return sorted.map((p, i) => {
    const tie = prev && prev.stats.countries === p.stats.countries && prev.stats.cities === p.stats.cities && prev.stats.trips === p.stats.trips;
    if (!tie) rank = i + 1;
    prev = p;
    return { ...p, rank };
  });
}

export interface PersonDTO {
  userId: string;
  handle: string;
  displayName: string;
  homeCity: string;
}

export interface ProfileDTO extends PersonDTO {
  bio: string;
  followers: number;
  following: number;
  stats: TravelStats;
  /** Present when the viewer may see the list (self, follower, or the owner made it public). */
  places: PastTrip[] | null;
  isMe: boolean;
  iFollow: boolean;
  followsMe: boolean;
}

export interface MyCommunityProfile extends PersonDTO {
  bio: string;
  defaultVisibility: Visibility;
  placesPublic: boolean;
}

/** A trip as other people see it: the plan and a light summary, never the personal intake. */
export interface CommunityTrip {
  id: string;
  title: string;
  destination: string;
  cityKey: string;
  days: number;
  party: string;
  pace: string;
  budget: string;
  interests: string[];
  hasHotels: boolean;
  likes: number;
  ownerRating: number;
  iLiked: boolean;
  visibility: Visibility;
  createdAt: string;
  owner: PersonDTO;
  itinerary?: Itinerary;
}

export interface LeaderboardRow {
  person: PersonDTO;
  stats: TravelStats;
  rank: number;
  isMe: boolean;
}

/** Ranking for "top trips in a city": likes matter most, then the owner's own rating, then freshness. */
export function topTripScore(t: { likes: number; ownerRating: number; createdAt: string }, now = Date.now()) {
  const ageDays = Math.max(0, (now - new Date(t.createdAt).getTime()) / 86_400_000);
  return t.likes * 3 + t.ownerRating + Math.max(0, 2 - ageDays / 90);
}

/**
 * "About you" answers that the trip's notes are written around (the planner adds an LGBTQ+ safety
 * note for an LGBTQ+ traveler), so notes shown to anyone else would give the answer away.
 */
const NOTES_REVEAL: readonly (typeof ABOUT_OPTIONS)[number][] = ["LGBTQ+ traveler"];

/**
 * Strip anything the planner used that shouldn't leave the owner's account. Pass the trip's
 * request (its "About you" answers stay private): when they include one of NOTES_REVEAL, the
 * notes are left out too. Every public view of someone's trip (share links, community trips,
 * link previews) goes through here.
 */
export function publicItinerary(it: Itinerary, request?: { about?: readonly string[] | null } | null): Itinerary {
  const { replaced: _replaced, ...rest } = it;
  const raw: unknown = request?.about;
  const about: readonly unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const privateNotes = about.some((a) => (NOTES_REVEAL as readonly unknown[]).includes(a));
  // "For you" lines are about the owner's own trips and favorites: never shown to anyone else.
  return {
    ...rest,
    summary: "",
    forYou: "",
    replaced: [],
    notes: privateNotes ? [] : rest.notes,
    days: rest.days.map((d) => ({ ...d, stops: d.stops.map(({ locked: _l, candidateId: _c, forYou: _f, ...s }) => s) })),
    hotels: (rest.hotels ?? []).map(({ candidateId: _c, expediaPropertyId: _e, liveRate: _r, forYou: _f, ...h }) => h),
  };
}

/** A short history block for the planner: where they've been and what they loved. */
export function historyForPrompt(places: PastTrip[], destination: string, countryName: (c: string) => string): string {
  if (!places.length) return "";
  const dest = cityKey(destination);
  const sorted = [...places].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.year ?? 0) - (a.year ?? 0)).slice(0, 15);
  const been = sorted.filter((p) => cityKey(p.city) === dest);
  const lines = sorted.map((p) => {
    const when = p.year ? ` (${p.year})` : "";
    const stars = p.rating ? `, rated ${p.rating}/5` : "";
    const hi = p.highlights ? `: loved ${p.highlights.replace(/\s+/g, " ").slice(0, 160)}` : "";
    return `- ${p.city}, ${countryName(p.countryCode)}${when}${stars}${hi}`;
  });
  const stats = travelStats(places);
  return `TRAVEL HISTORY (${stats.countries} countries, ${stats.cities} cities)
Use it to read their taste: lean toward what they rated highly and what they say they loved. Don't explain the history back to them, except in the trip's one "forYou" line.
${lines.join("\n")}${
    been.length
      ? `\nThey have been to ${been[0]!.city} before: skip the obvious first-timer sights unless asked, and favor neighborhoods and places a returning visitor wouldn't know.`
      : ""
  }`;
}
