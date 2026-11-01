import type { SharedTrip } from "@travel/core";
import { supabaseAdmin } from "./supabase/server";
import type { TripRow } from "./trips";

const TOKEN = /^[A-Za-z0-9_-]{12,40}$/;

/**
 * Load a trip by its public token. Only trips whose owner turned sharing on are returned,
 * and only the plan itself: no ratings, votes, personal "about you" details, notes to the
 * planner, or travel dates.
 */
export async function getSharedTrip(token: string): Promise<SharedTrip | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await supabaseAdmin()
    .from("trips")
    .select("title, destination, request, itinerary, created_at, shared, share_token")
    .eq("share_token", token)
    .eq("shared", true)
    .maybeSingle();
  if (error) console.error("shared trip lookup failed", error.message);
  if (!data) return null;
  const row = data as Pick<TripRow, "title" | "destination" | "request" | "itinerary" | "created_at">;
  const { replaced: _replaced, ...itinerary } = row.itinerary;
  return {
    title: row.title,
    destination: row.destination,
    days: row.itinerary.days.length,
    party: row.request?.party ?? "",
    itinerary: {
      ...itinerary,
      replaced: [],
      days: itinerary.days.map((d) => ({ ...d, stops: d.stops.map(({ locked: _l, candidateId: _c, ...s }) => s) })),
      hotels: (itinerary.hotels ?? []).map(({ candidateId: _c, expediaPropertyId: _e, liveRate: _r, ...h }) => h),
    },
    createdAt: row.created_at,
  };
}
