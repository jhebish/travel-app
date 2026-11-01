import { buildFeedback, hasSignal } from "@travel/core";
import { supabaseAdmin } from "./supabase/server";
import type { TripRow } from "./trips";

/**
 * Keep the anonymized feedback row in step with a trip.
 * Written with the service role: travelers can't write this table and curators can only read it.
 */
export async function syncFeedback(row: TripRow): Promise<void> {
  const db = supabaseAdmin();
  const t = { saved: row.saved, rating: row.rating, votes: row.votes ?? {} };
  if (!hasSignal(t)) {
    await db.from("trip_feedback").delete().eq("trip_id", row.id);
    return;
  }
  const fb = buildFeedback({
    request: row.request,
    itinerary: row.itinerary,
    weights: row.weights,
    custom_mix: row.custom_mix,
    ...t,
  });
  const { error } = await db.from("trip_feedback").upsert({ trip_id: row.id, ...fb });
  if (error) console.error("feedback sync failed", error.code ?? "", (error.message ?? "").slice(0, 80).replace(/sb_[A-Za-z0-9_]+/g, "[key]"));
}
