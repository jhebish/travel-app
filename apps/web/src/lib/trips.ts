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
});

export const toSummary = (r: TripRow): TripSummary => ({
  id: r.id,
  createdAt: r.created_at,
  destination: r.destination,
  title: r.title,
  days: r.request?.days ?? r.itinerary?.days?.length ?? 0,
  saved: r.saved,
  rating: r.rating,
  customMix: r.custom_mix,
  hasHotels: (r.itinerary?.hotels?.length ?? 0) > 0,
});
