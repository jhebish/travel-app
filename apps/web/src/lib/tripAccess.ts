import type { Itinerary, Trip, TripRequest, Votes } from "@travel/core";
import type { Ctx } from "./auth";
import { HttpError, isUuid } from "./http";
import { supabaseAdmin } from "./supabase/server";
import { toTrip, type TripRow } from "./trips";

/**
 * Who may open and change a trip. Trips are written only through the server (the database lets
 * travelers change just saved/rating/votes directly), so every write goes through here after
 * checking the caller is the owner or a friend planning the trip with them.
 */
export type TripRole = "owner" | "member";

/** A failed lookup is not "not found": say so, rather than telling people their trip is gone. */
function lookupFailed(what: string, error: { code?: string; message?: string }): never {
  console.error(`${what} lookup failed`, error.code ?? "", (error.message ?? "").slice(0, 120));
  throw new HttpError(503, "We couldn't load this trip just now. Try again in a moment.", "unavailable");
}

export async function tripFor(ctx: Ctx, id: string, need: TripRole = "member"): Promise<{ row: TripRow; role: TripRole }> {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  if (!isUuid(id)) throw new HttpError(404, "Trip not found.");
  const db = supabaseAdmin();
  const { data, error } = await db.from("trips").select("*").eq("id", id).maybeSingle();
  if (error) lookupFailed("trip", error);
  if (!data) throw new HttpError(404, "Trip not found.");
  const row = data as TripRow;
  if (row.user_id === ctx.user.id) return { row, role: "owner" };
  if (need === "member") {
    const { data: m, error: mErr } = await db.from("trip_members").select("user_id").eq("trip_id", id).eq("user_id", ctx.user.id).maybeSingle();
    // 42P01 / PGRST205: the planning-together tables aren't set up yet, so nobody is a member.
    if (mErr && !["42P01", "PGRST205"].includes(mErr.code ?? "")) lookupFailed("trip member", mErr);
    if (m) return { row, role: "member" };
  }
  throw new HttpError(404, "Trip not found.");
}

/**
 * Save changes to a trip, but only if nobody else changed it since `row` was read
 * (`updated_at` moves on every write). Otherwise: 409, reload and try again.
 */
export async function updateTrip(
  row: TripRow,
  patch: Partial<{ itinerary: Itinerary; votes: Votes; request: TripRequest; title: string; shared: boolean; share_token: string; visibility: string }>,
): Promise<TripRow> {
  const { data, error } = await supabaseAdmin().from("trips").update(patch).eq("id", row.id).eq("updated_at", row.updated_at).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "This trip was just changed (maybe by a friend planning it with you). Reload to see the latest, then try again.", "conflict");
  return data as TripRow;
}

/**
 * A trip as a friend planning it sees it: the owner's private intake answers and votes stay
 * private, and so do the "For you" notes on the trip, its stops and hotels (they're written from
 * the owner's own history: "like the tasca you loved in Porto"). Edits are sent as actions, never
 * as the itinerary, so what's left out here is never written back.
 */
export function tripForRole(row: TripRow, role: TripRole): Trip {
  const t = toTrip(row);
  if (role === "owner") return { ...t, role };
  const it = t.itinerary;
  return {
    ...t,
    role,
    itinerary: {
      ...it,
      forYou: "",
      // Nor whose friend's pick a stop was: those friends shared their places with the owner.
      days: it.days.map((d) => ({ ...d, stops: d.stops.map(({ forYou: _f, friend: _fr, ...s }) => s) })),
      hotels: (it.hotels ?? []).map(({ forYou: _f, friend: _fr, ...h }) => h),
    },
    request: { ...t.request, about: [], extra: "", age: null, startDate: t.request.startDate ?? null },
    votes: {},
    rating: 0,
    saved: false,
    shareToken: null,
  };
}

/**
 * Count this action against the person's hourly limit. The event is recorded before the work
 * starts, so requests fired in parallel count against each other.
 */
export async function rateLimit(ctx: Ctx, kind: "build" | "edit" | "hotels" | "extract" | "taste" | "sample" | "gmail", perHour: number, message: string) {
  if (!ctx.user) return;
  const db = supabaseAdmin();
  const { error } = await db.from("rate_events").insert({ user_id: ctx.user.id, kind });
  if (error) {
    if (error.code !== "42P01") console.error("rate event failed", error.code);
    return; // table not created yet: don't block people
  }
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("rate_events").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("kind", kind).gte("created_at", since);
  if ((count ?? 0) > perHour) throw new HttpError(429, message, "rate_limited");
}
