import { createHash } from "node:crypto";
import {
  TASTE_TOOL,
  TasteProfileSchema,
  buildTastePrompt,
  cityKey,
  countryName,
  rankSignals,
  tasteForPrompt,
  type SignalKind,
  type SignalSource,
  type TasteFeedback,
  type TasteProfile,
  type TasteProfileCore,
  type TasteSignal,
} from "@travel/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "./auth";
import { callTool } from "./claude";
import { supabaseAdmin } from "./supabase/server";
import type { TripRow } from "./trips";

export interface StoredSignal extends TasteSignal {
  id: string;
  pastTripId: string | null;
}

const SIGNAL_COLS = "id, past_trip_id, source, ref, kind, name, city, country_code, lat, lng, visited_on, rating, liked, note, url";
interface SignalRow {
  id: string;
  past_trip_id: string | null;
  source: SignalSource;
  ref: string;
  kind: SignalKind;
  name: string;
  city: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  visited_on: string | null;
  rating: number | null;
  liked: boolean | null;
  note: string | null;
  url: string | null;
}
const toSignal = (r: SignalRow): StoredSignal => ({
  id: r.id,
  pastTripId: r.past_trip_id,
  source: r.source,
  ref: r.ref,
  kind: r.kind,
  name: r.name,
  city: r.city,
  countryCode: r.country_code,
  lat: r.lat,
  lng: r.lng,
  date: r.visited_on,
  rating: r.rating,
  liked: r.liked,
  note: r.note,
  url: r.url,
});
export const signalRow = (userId: string, s: TasteSignal, pastTripId: string | null = null) => ({
  user_id: userId,
  past_trip_id: pastTripId,
  source: s.source,
  ref: s.ref,
  kind: s.kind,
  name: s.name,
  city: s.city ?? null,
  country_code: s.countryCode ?? null,
  lat: s.lat ?? null,
  lng: s.lng ?? null,
  visited_on: s.date ?? null,
  rating: s.rating ?? null,
  liked: s.liked ?? null,
  note: s.note ?? null,
  url: s.url ?? null,
});

export async function loadSignals(db: SupabaseClient, userId: string, limit = 2000): Promise<StoredSignal[]> {
  const { data, error } = await db.from("taste_signals").select(SIGNAL_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (error.code !== "42P01") console.error("signals load failed", error.code);
    return [];
  }
  return (data as SignalRow[]).map(toSignal);
}

/** Thumbs on stops and hotels in their Pylos trips, as "Name (City, kind)". */
async function loadFeedback(db: SupabaseClient, userId: string): Promise<TasteFeedback> {
  const { data } = await db
    .from("trips")
    .select("destination, itinerary, votes")
    .eq("user_id", userId)
    .neq("votes", "{}")
    .order("updated_at", { ascending: false })
    .limit(30);
  const fb: TasteFeedback = { liked: [], disliked: [] };
  for (const t of (data ?? []) as Pick<TripRow, "destination" | "itinerary" | "votes">[]) {
    const city = t.destination.split(",")[0]!.trim();
    for (const [k, v] of Object.entries(t.votes ?? {})) {
      const [a, b] = k.split("-");
      const place = a === "h" ? t.itinerary.hotels?.[Number(b)] : t.itinerary.days[Number(a)]?.stops[Number(b)];
      if (!place) continue;
      const label = `${place.name} (${"city" in place && place.city ? place.city : city}, ${a === "h" ? "hotel" : "stop"})`;
      (v === 1 ? fb.liked : fb.disliked).push(label);
    }
  }
  return fb;
}

async function loadPastTrips(db: SupabaseClient, userId: string) {
  const { data } = await db.from("past_trips").select("city, country_code, year, rating, highlights").eq("user_id", userId).limit(200);
  return (data ?? []).map((r) => ({ city: r.city as string, country: countryName(r.country_code as string), year: r.year as number | null, rating: r.rating as number | null, highlights: (r.highlights as string) ?? "" }));
}

export async function getCachedProfile(userId: string): Promise<{ profile: TasteProfile; hash: string } | null> {
  const { data, error } = await supabaseAdmin().from("taste_profiles").select("profile, inputs_hash").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return { profile: data.profile as TasteProfile, hash: data.inputs_hash as string };
}

async function tasteInputs(db: SupabaseClient, userId: string) {
  const [pastTrips, signals, feedback] = await Promise.all([loadPastTrips(db, userId), loadSignals(db, userId), loadFeedback(db, userId)]);
  const hash = createHash("sha1")
    .update(JSON.stringify([pastTrips, signals.map((s) => [s.id, s.rating, s.liked, s.note]), feedback]))
    .digest("hex");
  return { pastTrips, signals, feedback, hash };
}

/** Is the cached profile out of date (or missing while there's something to learn from)? */
export async function tasteState(ctx: Ctx & { user: { id: string } }) {
  const [inputs, cached] = await Promise.all([tasteInputs(ctx.db, ctx.user.id), getCachedProfile(ctx.user.id)]);
  const evidence = inputs.signals.length + inputs.pastTrips.length + inputs.feedback.liked.length + inputs.feedback.disliked.length;
  return { inputs, cached, evidence, stale: evidence > 0 && cached?.hash !== inputs.hash };
}

/** Rebuild the taste profile if anything changed since it was last built. */
export async function refreshTaste(ctx: Ctx & { user: { id: string } }): Promise<TasteProfile | null> {
  const { inputs, cached, evidence, stale } = await tasteState(ctx);
  if (!stale) return cached?.profile ?? null;
  if (!evidence) return null;
  const { input } = await callTool(buildTastePrompt(inputs), TASTE_TOOL, 1500, { fast: true });
  const parsed = TasteProfileSchema.safeParse(input);
  if (!parsed.success) return cached?.profile ?? null;
  const profile: TasteProfile = { ...parsed.data, signals: inputs.signals.length, updatedAt: new Date().toISOString() };
  const { error } = await supabaseAdmin().from("taste_profiles").upsert({ user_id: ctx.user.id, inputs_hash: inputs.hash, profile, updated_at: profile.updatedAt });
  if (error) console.error("taste profile save failed", error.code);
  return profile;
}

/**
 * The strongest place signals for a trip to `destination`: places in the same city or country
 * first (they've been before), then their all-time favorites.
 */
function favoritesFor(signals: StoredSignal[], destination: string): StoredSignal[] {
  const dest = cityKey(destination);
  const places = rankSignals(signals.filter((s) => s.kind !== "city" && (s.liked != null || s.rating != null)));
  const near = places.filter((s) => s.city && cityKey(s.city) === dest);
  return [...near, ...places.filter((s) => !near.includes(s))].slice(0, 14);
}

/**
 * The TASTE section for the planner. Uses each person's cached profile (no model call here) plus
 * their strongest signals. `people` is the trip owner plus anyone planning with them.
 */
export async function tasteBlock(people: { userId: string; label: string | null }[], destination: string): Promise<string> {
  if (!people.length) return "";
  const db = supabaseAdmin();
  const each = await Promise.all(
    people.map(async (p) => {
      const [signals, cached] = await Promise.all([loadSignals(db, p.userId, 600), getCachedProfile(p.userId)]);
      return { label: p.label, profile: (cached?.profile as TasteProfileCore | undefined) ?? null, favorites: favoritesFor(signals, destination) };
    }),
  );
  return tasteForPrompt(each);
}
