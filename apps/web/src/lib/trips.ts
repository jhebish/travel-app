import type { Itinerary, Trip, TripRequest, TripSummary, Votes, Weights } from "@travel/core";

export type { Trip, TripSummary };

export interface TripRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  destination: string;
  title: string;
  request: TripRequest;
  weights: Weights;
  blocked: string[];
  custom_mix: boolean;
  itinerary: Itinerary;
  saved: boolean;
  rating: number;
  votes: Votes;
  model: string | null;
  shared?: boolean;
  share_token?: string | null;
  visibility?: "private" | "followers" | "public";
  share_while_away?: boolean;
}

export const toTrip = (r: TripRow): Trip => ({
  id: r.id,
  createdAt: r.created_at,
  destination: r.destination,
  title: r.title,
  request: r.request,
  weights: r.weights,
  customMix: r.custom_mix,
  itinerary: r.itinerary,
  saved: r.saved,
  rating: r.rating,
  votes: r.votes ?? {},
  shareToken: r.shared ? (r.share_token ?? null) : null,
  visibility: r.visibility ?? "private",
  shareWhileAway: r.share_while_away ?? false,
});

/** The few columns a trip list needs (selected with JSON paths, so itineraries aren't loaded). */
export interface SlimTripRow {
  id: string;
  created_at: string;
  destination: string;
  title: string;
  custom_mix: boolean;
  saved: boolean;
  rating: number;
  days?: number | null;
  first_hotel?: string | null;
  request?: TripRow["request"];
  itinerary?: TripRow["itinerary"];
}

export const toSummary = (r: SlimTripRow): TripSummary => ({
  id: r.id,
  createdAt: r.created_at,
  destination: r.destination,
  title: r.title,
  days: r.days ?? r.request?.days ?? r.itinerary?.days?.length ?? 0,
  saved: r.saved,
  rating: r.rating,
  customMix: r.custom_mix,
  hasHotels: r.first_hotel != null || (r.itinerary?.hotels?.length ?? 0) > 0,
});
