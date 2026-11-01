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
