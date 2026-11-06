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

// ---------------------------------------------------------------------------
// Taste profile: the planner's read of someone's taste, built by the model from their signals,
// past trips and thumbs on Pylos trips. Cached per person; steers hotel and restaurant picks.
// ---------------------------------------------------------------------------

const words = (n: number, max: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(/[,;]\s*/) : []),
    z.array(z.unknown()).transform((a) =>
      a
        .filter((x): x is string => typeof x === "string" && !!x.trim())
        .map((x) => x.trim().slice(0, n))
        .slice(0, max),
    ),
  );
const text = (n: number) => z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, n) : ""), z.string());

export const TasteProfileSchema = z.object({
  /** One or two sentences, in the second person: "You like small design hotels and long lunches…" */
  summary: text(320),
  stays: z.object({ styles: words(40, 6), price: text(40), likes: words(80, 6), avoid: words(80, 4) }).catch({ styles: [], price: "", likes: [], avoid: [] }),
  food: z.object({ cuisines: words(40, 8), vibes: words(60, 6), price: text(40), avoid: words(80, 4) }).catch({ cuisines: [], vibes: [], price: "", avoid: [] }),
  activities: words(60, 8),
});
export type TasteProfileCore = z.infer<typeof TasteProfileSchema>;
export interface TasteProfile extends TasteProfileCore {
  /** How many signals it was built from. */
  signals: number;
  updatedAt: string;
}

export const TASTE_TOOL = {
  name: "submit_taste",
  description: "Submit the traveler's taste profile.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "1–2 short sentences in the second person, specific (no clichés like 'you love to travel')." },
      stays: {
        type: "object",
        properties: {
          styles: { type: "array", items: { type: "string" }, description: "e.g. Boutique, Design, Historic, Guesthouse" },
          price: { type: "string", description: "Typical nightly band they choose, e.g. '$150–300', or empty." },
          likes: { type: "array", items: { type: "string" }, description: "Concrete traits, e.g. 'courtyards', 'rooftop breakfast'." },
          avoid: { type: "array", items: { type: "string" } },
        },
        required: ["styles", "price", "likes", "avoid"],
      },
      food: {
        type: "object",
        properties: {
          cuisines: { type: "array", items: { type: "string" } },
          vibes: { type: "array", items: { type: "string" }, description: "e.g. 'counter seating', 'natural wine', 'old-school taverns'." },
          price: { type: "string" },
          avoid: { type: "array", items: { type: "string" } },
        },
        required: ["cuisines", "vibes", "price", "avoid"],
      },
      activities: { type: "array", items: { type: "string" }, description: "What they like doing: e.g. 'markets', 'long walks', 'architecture'." },
    },
    required: ["summary", "stays", "food", "activities"],
  },
} as const;

export interface TastePastTrip {
  city: string;
  country: string;
  year?: number | null;
  rating?: number | null;
  highlights?: string;
}
export interface TasteFeedback {
  /** "Name (City, kind)" for places they gave a thumbs up / down in Pylos trips. */
  liked: string[];
  disliked: string[];
}

const KIND_WEIGHT: Record<SignalKind, number> = { stay: 3, food: 3, drink: 2, coffee: 2, nightlife: 1, activity: 1, sight: 1, shop: 1, city: 0 };
/** Strongest evidence first: explicit likes and high ratings, places over cities, then recent. */
export function rankSignals<T extends Pick<TasteSignal, "kind" | "rating" | "liked" | "date">>(signals: T[]): T[] {
  const score = (s: T) =>
    (s.liked === true ? 4 : s.liked === false ? 3 : 0) +
    (s.rating ? Math.abs(s.rating - 3) * 1.5 : 0) +
    KIND_WEIGHT[s.kind] +
    (s.date ? Math.max(0, 2 - (Date.now() - Date.parse(s.date)) / (3 * 365 * 864e5)) : 0);
  return [...signals].sort((a, b) => score(b) - score(a));
}

const sigLine = (s: Pick<TasteSignal, "kind" | "name" | "city" | "rating" | "liked" | "note">) =>
  `- ${SIGNAL_KIND_LABELS[s.kind]}: ${s.name}${s.city ? ` (${s.city})` : ""}${s.rating ? ` ★${s.rating}` : ""}${
    s.liked === true ? " · loved" : s.liked === false ? " · didn't like" : ""
  }${s.note ? ` · "${s.note.replace(/\s+/g, " ").slice(0, 120)}"` : ""}`;

/** The prompt that turns someone's places into a taste profile. */
export function buildTastePrompt(input: { pastTrips: TastePastTrip[]; signals: TasteSignal[]; feedback: TasteFeedback }): string {
  const sigs = rankSignals(input.signals.filter((s) => s.kind !== "city")).slice(0, 160);
  const cities = input.signals.filter((s) => s.kind === "city").slice(0, 40);
  return `Read this traveler's taste from the places they've been and how they felt about them. The app uses your profile to choose hotels and restaurants they will love on future trips.
Use only the evidence below. Prefer concrete traits (e.g. "courtyard riads", "natural wine bars", "counter seating") over generic words. Leave a field empty rather than guess.

PAST TRIPS
${input.pastTrips.length ? input.pastTrips.slice(0, 40).map((t) => `- ${t.city}, ${t.country}${t.year ? ` (${t.year})` : ""}${t.rating ? ` ★${t.rating}` : ""}${t.highlights ? `: ${t.highlights.replace(/\s+/g, " ").slice(0, 200)}` : ""}`).join("\n") : "(none)"}

PLACES (strongest evidence first)
${sigs.length ? sigs.map(sigLine).join("\n") : "(none)"}
${cities.length ? `\nCITIES VISITED\n${cities.map((c) => `- ${c.name}${c.date ? ` (${c.date.slice(0, 4)})` : ""}`).join("\n")}\n` : ""}
THUMBS ON PYLOS TRIPS
Liked: ${input.feedback.liked.slice(0, 30).join("; ") || "(none)"}
Not for them: ${input.feedback.disliked.slice(0, 20).join("; ") || "(none)"}

Call submit_taste.`;
}

/**
 * The taste block the planner sees. `favorites` are the person's strongest place signals,
 * nearest to this trip first. With several people (planning together) pass one entry each.
 */
export function tasteForPrompt(
  people: { label: string | null; profile: TasteProfileCore | null; favorites: Pick<TasteSignal, "kind" | "name" | "city" | "rating" | "liked" | "note">[] }[],
): string {
  const parts = people
    .filter((p) => p.profile?.summary || p.favorites.length)
    .map((p) => {
      const t = p.profile;
      const loved = p.favorites.filter((f) => f.liked !== false && (f.rating ?? 4) >= 4).slice(0, 10);
      const disliked = p.favorites.filter((f) => f.liked === false || (f.rating != null && f.rating <= 2)).slice(0, 5);
      const lines = [
        t?.summary ? `- In short: ${t.summary}` : "",
        t && (t.stays.styles.length || t.stays.likes.length)
          ? `- Stays: ${[t.stays.styles.join(", "), t.stays.price, t.stays.likes.length ? `likes ${t.stays.likes.join(", ")}` : "", t.stays.avoid.length ? `avoid ${t.stays.avoid.join(", ")}` : ""].filter(Boolean).join("; ")}`
          : "",
        t && (t.food.cuisines.length || t.food.vibes.length)
          ? `- Food and drink: ${[t.food.cuisines.join(", "), t.food.vibes.join(", "), t.food.price, t.food.avoid.length ? `avoid ${t.food.avoid.join(", ")}` : ""].filter(Boolean).join("; ")}`
          : "",
        t?.activities.length ? `- Likes doing: ${t.activities.join(", ")}` : "",
        loved.length ? `- Places they loved: ${loved.map((f) => `${f.name}${f.city ? ` (${f.city})` : ""}`).join("; ")}` : "",
        disliked.length ? `- Places that weren't for them: ${disliked.map((f) => `${f.name}${f.city ? ` (${f.city})` : ""}`).join("; ")}` : "",
      ].filter(Boolean);
      return `${p.label ? `${p.label}:\n` : ""}${lines.join("\n")}`;
    });
  if (!parts.length) return "";
  const together = people.length > 1;
  const example = people.flatMap((p) => p.favorites).find((f) => f.kind !== "city" && f.liked !== false && (f.rating ?? 4) >= 4)?.name;
  return `TASTE (learned from places ${together ? "these travelers have" : "this traveler has"} been and rated: use it to predict which hotels and restaurants ${together ? "they" : "they"} will love)
${parts.join("\n\n")}
Prefer places with the same character as their favorites (the same feel, not the same place).${together ? " They're planning this trip together: favor places that suit everyone; where tastes differ, balance them across the days." : ""}
When a pick clearly matches this taste, set "forYou" to a few words naming the link to one of their favorites or a trait above (e.g. ${example ? `"Like ${example}: same easy feel" or ` : ""}"Your kind of natural wine bar"). Otherwise leave "forYou" empty. Never invent favorites.`;
}
