import type { Votes } from "./insights";
import type { Hotel, Itinerary, TripRequest } from "./schemas";
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
  /** Who can see it in the community. */
  visibility?: "private" | "followers" | "public";
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

/** Streamed while a trip is being built (newline-delimited JSON from POST /api/trips). */
export type BuildEvent =
  | { type: "progress"; pct: number; label: string }
  /** Sent first when the request came from somewhere else (a Typeform), so the client knows what's being built. */
  | { type: "request"; request: TripRequest }
  | {
      type: "outline";
      title: string;
      summary?: string;
      days: { label: string; theme: string; city?: string }[];
      hotels: boolean;
      /** Multi-city trips: the stops in order. */
      route?: { city: string; days: number }[];
    }
  /** A day finished; `day` carries it so the client can show it straight away. */
  | { type: "day"; index: number; day?: Itinerary["days"][number] }
  | { type: "hotels"; hotels?: Hotel[] }
  /** The traveler asked to be inspired instead (Typeform "not sure yet"). */
  | { type: "redirect"; to: string }
  | { type: "done"; trip: Trip }
  | { type: "error"; message: string; code?: string };
