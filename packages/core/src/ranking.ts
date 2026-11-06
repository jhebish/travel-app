import type { TripRequest } from "./schemas";
import type { PlaceVerification } from "./schemas";
import { STAY_PRICE_RANGE, type SourceId, type StayPrice } from "./sources";
import type { EffectiveSources } from "./weights";

export type CandidateCategory = "food" | "drink" | "culture" | "outdoors" | "shopping" | "nightlife" | "stay" | "other";

/** A real place the planner may use, from a local pick or a Places search. */
export interface Candidate {
  id: string; // stable within one request, e.g. "lp_<uuid>" or "gp_<placeId>"
  origin: "local_pick" | "google";
  name: string;
  neighborhood?: string | null;
  category: CandidateCategory;
  source: SourceId;
  note?: string | null;
  tags?: string[];
  placeId?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  priceLevel?: number | null; // 0–4 (Google)
  stayStyle?: string | null;
  priceBand?: StayPrice | null;
  expediaPropertyId?: string | null;
  /** Google Places details from the search that found it, so it needn't be looked up again. */
  verification?: PlaceVerification;
}

const INTEREST_CATEGORIES: Record<string, CandidateCategory[]> = {
  Food: ["food"],
  Nightlife: ["nightlife", "drink"],
  "Art & design": ["culture", "shopping"],
  History: ["culture"],
  "Nature & outdoors": ["outdoors"],
  "Markets & shopping": ["shopping", "food"],
  "Live music": ["nightlife", "culture"],
  Wellness: ["outdoors", "other"],
};

const hasTag = (c: Candidate, ...needles: string[]) =>
  (c.tags ?? []).some((t) => needles.some((n) => t.toLowerCase().includes(n)));

/** Google price level (0–4) to a rough nightly USD midpoint for stays. */
const PRICE_LEVEL_NIGHTLY = [80, 120, 220, 420, 800];

/**
 * Score a candidate for this traveler. Source weight dominates (that's the product),
 * then fit to the request, then light quality signals.
 * Returns -Infinity for candidates that must not be used.
 */
export function scoreCandidate(c: Candidate, eff: EffectiveSources, req: TripRequest): number {
  if (eff.blocked.includes(c.source)) return Number.NEGATIVE_INFINITY;
  const w = eff.weights[c.source] ?? 0;
  if (w <= 0) return Number.NEGATIVE_INFINITY;

  let score = w / 10; // 0..1

  // Fit
  if (c.category === "stay") {
    if (req.stay.on) {
      if (req.stay.styles.length && c.stayStyle && req.stay.styles.some((s) => s === c.stayStyle)) score += 0.3;
      const [lo, hi] = STAY_PRICE_RANGE[req.stay.price];
      if (c.priceBand) score += c.priceBand === req.stay.price ? 0.3 : -0.2;
      else if (c.priceLevel != null) {
        const mid = PRICE_LEVEL_NIGHTLY[Math.max(0, Math.min(4, c.priceLevel))]!;
        score += mid >= lo && mid <= hi ? 0.15 : -0.15;
      }
    }
  } else {
    const wanted = new Set(req.interests.flatMap((i) => INTEREST_CATEGORIES[i] ?? []));
    if (wanted.has(c.category)) score += 0.25;
    if (req.about.includes("Eats halal") && c.category === "food") score += hasTag(c, "halal") ? 0.3 : -0.1;
    if (req.about.includes("Vegetarian") && c.category === "food") score += hasTag(c, "vegetarian", "vegan") ? 0.2 : 0;
    if (req.about.includes("Doesn't drink alcohol") && (c.category === "drink" || c.category === "nightlife")) score -= 0.4;
    if (req.about.includes("LGBTQ+ traveler") && hasTag(c, "lgbtq", "queer", "gay")) score += 0.25;
    if (req.party === "Family with kids" && c.category === "nightlife") score -= 0.5;
    if (req.budget === "Budget" && (c.priceLevel ?? 0) >= 3) score -= 0.2;
  }

  // Quality signals, kept small so they never outweigh the source mix
  if (c.rating != null) score += Math.max(0, c.rating - 4) * 0.1; // up to +0.1
  // Locals-first: very heavily reviewed places skew touristy
  if ((c.ratingCount ?? 0) > 8000) score -= 0.1;
  if (c.origin === "local_pick") score += 0.1; // human-vetted

  return score;
}

export interface SelectOptions {
  maxActivities?: number;
  maxStays?: number;
}

/** Rank and trim candidates to what we hand the model. */
export function selectCandidates(
  all: Candidate[],
  eff: EffectiveSources,
  req: TripRequest,
  { maxActivities = 45, maxStays = 12 }: SelectOptions = {},
): Candidate[] {
  const seen = new Set<string>();
  const scored = all
    .filter((c) => {
      const key = (c.placeId ?? `${c.name}|${c.neighborhood ?? ""}`).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => ({ c, s: scoreCandidate(c, eff, req) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => b.s - a.s);
  const acts = scored.filter((x) => x.c.category !== "stay").slice(0, maxActivities);
  const stays = req.stay.on ? scored.filter((x) => x.c.category === "stay").slice(0, maxStays) : [];
  return [...acts, ...stays].map((x) => x.c);
}

/** Search queries for Places, derived from the request. */
export function placesQueries(req: TripRequest): { query: string; category: CandidateCategory }[] {
  const city = req.destination;
  const q: { query: string; category: CandidateCategory }[] = [];
  const add = (query: string, category: CandidateCategory) => q.push({ query: `${query} in ${city}`, category });
  const halal = req.about.includes("Eats halal");
  const veg = req.about.includes("Vegetarian");
  add(halal ? "halal restaurants locals love" : veg ? "vegetarian restaurants locals love" : "neighborhood restaurants locals love", "food");
  add("local cafés", "food");
  for (const i of req.interests) {
    if (i === "Food") continue;
    if (i === "Nightlife" && (req.party === "Family with kids" || req.about.includes("Doesn't drink alcohol"))) continue;
    const map: Record<string, [string, CandidateCategory]> = {
      Nightlife: ["cocktail bars and late-night spots", "nightlife"],
      "Art & design": ["independent galleries and design shops", "culture"],
      History: ["historic sites and small museums", "culture"],
      "Nature & outdoors": ["parks, gardens and viewpoints", "outdoors"],
      "Markets & shopping": ["local markets", "shopping"],
      "Live music": ["live music venues", "nightlife"],
      Wellness: ["bathhouses, spas and yoga studios", "other"],
    };
    const m = map[i];
    if (m) add(m[0], m[1]);
  }
  if (req.about.includes("LGBTQ+ traveler")) add("LGBTQ+ friendly bars and cafés", "nightlife");
  if (req.stay.on) {
    const style = req.stay.styles[0]?.toLowerCase() ?? "boutique";
    add(`${style} hotels`, "stay");
    if (req.stay.styles.length > 1) add(`${req.stay.styles[1]!.toLowerCase()} hotels`, "stay");
  }
  return q.slice(0, 8);
}
