import { z } from "zod";

/**
 * Taste signals: single places a traveler has been to and how they felt about them, from
 * anywhere (typed into Pylos, a connected calendar, a Google Maps export, a pasted Resy list…).
 * The planner turns them into a taste profile that steers which hotels and restaurants it picks.
 */

export const SIGNAL_KINDS = ["stay", "food", "drink", "coffee", "nightlife", "sight", "activity", "shop", "city"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  stay: "Stayed",
  food: "Ate",
  drink: "Drinks",
  coffee: "Coffee",
  nightlife: "Night out",
  sight: "Saw",
  activity: "Did",
  shop: "Shopped",
  city: "Visited",
};

export const SIGNAL_SOURCES = [
  "manual", // typed into Pylos
  "google_calendar", // connected Google Calendar (trips, hotel stays, dinner reservations)
  "ics", // an uploaded calendar file
  "google_takeout", // Google Maps reviews and saved places
  "instagram", // connected account or data download
  "facebook", // connected account or data download
  "swarm", // Foursquare / Swarm check-ins export
  "paste", // pasted text (Resy or OpenTable history, Beli lists, notes)
] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];
export const SIGNAL_SOURCE_LABELS: Record<SignalSource, string> = {
  manual: "Added by you",
  google_calendar: "Google Calendar",
  ics: "Calendar file",
  google_takeout: "Google Maps",
  instagram: "Instagram",
  facebook: "Facebook",
  swarm: "Swarm",
  paste: "Pasted list",
};

export interface TasteSignal {
  source: SignalSource;
  /** Stable id within the source, so importing the same file twice doesn't duplicate places. */
  ref: string;
  kind: SignalKind;
  /** The place ("Bar Tartine"), or the city itself when kind is "city". */
  name: string;
  city?: string | null;
  /** ISO 3166-1 alpha-2, upper case, when known. */
  countryCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Day of the visit or event, YYYY-MM-DD. */
  date?: string | null;
  /** 1–5 when the source has a rating. */
  rating?: number | null;
  /** An explicit thumbs up (true) or down (false). */
  liked?: boolean | null;
  /** A short note: a review, caption or "what we ordered". At most 280 characters. */
  note?: string | null;
  url?: string | null;
}

const clip = (n: number) => z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, n) : v), z.string());
const optClip = (n: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, n) || null : v ?? null), z.string().nullable()).optional();

/** Validation for signals arriving at the API (manual entry and confirmed imports). */
export const TasteSignalSchema = z.object({
  source: z.enum(SIGNAL_SOURCES),
  ref: clip(200).pipe(z.string().min(1)),
  kind: z.enum(SIGNAL_KINDS),
  name: clip(120).pipe(z.string().min(1)),
  city: optClip(80),
  countryCode: z
    .preprocess((v) => (typeof v === "string" && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toUpperCase() : null), z.string().nullable())
    .optional(),
  lat: z.number().min(-90).max(90).nullable().optional().catch(null),
  lng: z.number().min(-180).max(180).nullable().optional().catch(null),
  date: z
    .preprocess((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null), z.string().nullable())
    .optional(),
  rating: z.number().int().min(1).max(5).nullable().optional().catch(null),
  liked: z.boolean().nullable().optional().catch(null),
  note: optClip(280),
  url: z
    .preprocess((v) => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim().slice(0, 500) : null), z.string().nullable())
    .optional(),
});
