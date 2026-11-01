import type { Votes } from "./insights";
import type { Itinerary, TripRequest } from "./schemas";
import type { SourceId, Weights } from "./sources";

/** Trip as returned by the API to the web and mobile apps. */
export interface Trip {
  id: string;
  createdAt: string;
  destination: string;
  title: string;
  request: TripRequest;
  weights: Weights;
  customMix: boolean;
  itinerary: Itinerary;
  saved: boolean;
  rating: number;
  votes: Votes;
  /** Present while the trip has a public link. */
  shareToken?: string | null;
}

/** What a public share link shows: the plan, without the traveler's personal details. */
export interface SharedTrip {
  title: string;
  destination: string;
  days: number;
  party: string;
  itinerary: Itinerary;
  createdAt: string;
}

export interface TripSummary {
  id: string;
  createdAt: string;
  destination: string;
  title: string;
  days: number;
  saved: boolean;
  rating: number;
  customMix: boolean;
  hasHotels: boolean;
}

export interface PrefsDTO {
  useCustom: boolean;
  weights: Weights;
  blocked: SourceId[];
}

export interface AppConfigDTO {
  weights: Weights;
  blocked: SourceId[];
  alwaysFeature: string;
  neverRecommend: string;
  updatedAt?: string;
}
