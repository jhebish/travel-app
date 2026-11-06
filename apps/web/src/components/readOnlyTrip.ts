import type { Itinerary, Trip, TripRequest } from "@travel/core";

/** A plan shown read-only (shared links, community trips, destination itineraries). */
export function readOnlyTrip(o: { destination: string; title: string; itinerary: Itinerary; party?: string; createdAt?: string }): Trip {
  const parties: TripRequest["party"][] = ["Solo", "Couple", "Family with kids", "Group of friends"];
  const request: TripRequest = {
    mode: o.itinerary.mode === "multi" ? "multi" : "single",
    destination: o.destination,
    days: Math.max(1, o.itinerary.days.length),
    startDate: null,
    party: parties.includes(o.party as TripRequest["party"]) ? (o.party as TripRequest["party"]) : "Couple",
    age: null,
    about: [],
    budget: "Mid-range",
    interests: [],
    pace: "Balanced",
    extra: "",
    stay: { on: false, styles: [], price: "$150–300" },
    with: [],
  };
  return {
    id: "",
    createdAt: o.createdAt ?? new Date(0).toISOString(),
    destination: o.destination,
    title: o.title,
    request,
    weights: {} as Trip["weights"],
    customMix: false,
    itinerary: o.itinerary,
    saved: false,
    rating: 0,
    votes: {},
  };
}
