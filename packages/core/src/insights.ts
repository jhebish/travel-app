import type { Itinerary, TripRequest } from "./schemas";
import { SOURCES, isSourceId, type SourceId, type Weights } from "./sources";

export type Votes = Record<string, 1 | -1>;

export interface FeedbackRow {
  destination: string;
  days: number;
  party: string | null;
  age_band: string | null;
  budget: string | null;
  pace: string | null;
  interests: string[];
  stay_styles: string[];
  stay_price: string | null;
  custom_mix: boolean;
  weights: Partial<Weights>;
  rating: number;
  saved: boolean;
  shares: Partial<Record<SourceId | "other", number>>;
  source_votes: Partial<Record<SourceId | "other", { up: number; down: number }>>;
  hotel_votes: { style: string; vote: 1 | -1 }[];
}

export interface TripForFeedback {
  request: TripRequest;
  itinerary: Itinerary;
  weights: Partial<Weights>;
  custom_mix: boolean;
  saved: boolean;
  rating: number;
  votes: Votes;
}

export const hasSignal = (t: { saved: boolean; rating: number; votes: Votes }) =>
  t.saved || t.rating > 0 || Object.keys(t.votes ?? {}).length > 0;

/**
 * Anonymized training row. Deliberately excludes request.about (personal details),
 * request.extra (free text), dates, and anything that identifies the traveler.
 */
export function buildFeedback(t: TripForFeedback): FeedbackRow {
  const shares: Record<string, number> = {};
  const votes: Record<string, { up: number; down: number }> = {};
  let n = 0;
  const count = (source: string, key: string) => {
    n++;
    const src = isSourceId(source) ? source : "other";
    shares[src] = (shares[src] ?? 0) + 1;
    const v = t.votes?.[key];
    if (v) {
      votes[src] ??= { up: 0, down: 0 };
      if (v > 0) votes[src]!.up++;
      else votes[src]!.down++;
    }
  };
  t.itinerary.days.forEach((d, di) => d.stops.forEach((s, si) => count(s.source, `${di}-${si}`)));
  (t.itinerary.hotels ?? []).forEach((h, hi) => count(h.source, `h-${hi}`));
  for (const k of Object.keys(shares)) shares[k] = Math.round((shares[k]! / Math.max(1, n)) * 1000) / 1000;

  const hotel_votes = Object.entries(t.votes ?? {})
    .filter(([k]) => k.startsWith("h-"))
    .map(([k, vote]) => ({ style: t.itinerary.hotels?.[Number(k.slice(2))]?.style || "Unspecified", vote }));

  const r = t.request;
  return {
    destination: r.destination,
    days: r.days,
    party: r.party ?? null,
    age_band: r.age ?? null,
    budget: r.budget ?? null,
    pace: r.pace ?? null,
    interests: r.interests ?? [],
    stay_styles: r.stay?.on ? r.stay.styles : [],
    stay_price: r.stay?.on ? r.stay.price : null,
    custom_mix: t.custom_mix,
    weights: t.weights,
    rating: t.rating,
    saved: t.saved,
    shares,
    source_votes: votes,
    hotel_votes,
  };
}

export interface SourceInsight {
  id: SourceId;
  stopsRated: number;
  upRate: number | null;
  avgStars: number | null;
  current: number;
  suggested: number | null;
}

export interface Insights {
  tripsWithFeedback: number;
  tripsRated: number;
  avgStars: number | null;
  saved: number;
  sources: SourceInsight[];
  hotelStyles: { style: string; rated: number; upRate: number }[];
}

export const MIN_VOTES_FOR_SUGGESTION = 5;

/**
 * Aggregate feedback and suggest new default weights.
 * Suggestion = halfway between the current weight and (thumbs-up rate × 10),
 * nudged up or down by how trips leaning on that source were rated versus average.
 */
export function aggregateInsights(rows: FeedbackRow[], current: Partial<Weights>, blocked: SourceId[]): Insights {
  const rated = rows.filter((r) => r.rating > 0);
  const avg = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : null;

  const sources: SourceInsight[] = SOURCES.map((s) => {
    let up = 0,
      down = 0,
      shareSum = 0,
      starSum = 0;
    for (const r of rows) {
      const v = r.source_votes?.[s.id];
      if (v) {
        up += v.up || 0;
        down += v.down || 0;
      }
      const sh = r.shares?.[s.id] ?? 0;
      if (sh && r.rating > 0) {
        shareSum += sh;
        starSum += sh * r.rating;
      }
    }
    const n = up + down;
    const upRate = n ? up / n : null;
    const avgStars = shareSum ? starSum / shareSum : null;
    const cur = current[s.id] ?? s.defaultWeight;
    let suggested: number | null = null;
    if (!blocked.includes(s.id) && n >= MIN_VOTES_FOR_SUGGESTION && upRate != null) {
      const starAdj = avgStars != null && avg != null ? (avgStars - avg) * 2 : 0;
      suggested = Math.max(0, Math.min(10, Math.round((cur + upRate * 10) / 2 + starAdj)));
    }
    return { id: s.id, stopsRated: n, upRate, avgStars, current: cur, suggested };
  });

  const byStyle: Record<string, { up: number; down: number }> = {};
  for (const r of rows)
    for (const hv of r.hotel_votes ?? []) {
      byStyle[hv.style] ??= { up: 0, down: 0 };
      if (hv.vote > 0) byStyle[hv.style]!.up++;
      else byStyle[hv.style]!.down++;
    }
  const hotelStyles = Object.entries(byStyle)
    .map(([style, v]) => ({ style, rated: v.up + v.down, upRate: v.up / Math.max(1, v.up + v.down) }))
    .sort((a, b) => b.rated - a.rated);

  return {
    tripsWithFeedback: rows.length,
    tripsRated: rated.length,
    avgStars: avg,
    saved: rows.filter((r) => r.saved).length,
    sources,
    hotelStyles,
  };
}
