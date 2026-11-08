import {
  byLoved,
  canSeePastTrip,
  pastTripForOthers,
  recapYears,
  travelPersonality,
  yearRecap,
  type PastTrip,
  type PersonDTO,
  type RecapSignal,
  type RecapTrip,
  type SignalKind,
  type Visibility,
  type YearRecap,
} from "@travel/core";
import type { Ctx } from "./auth";
import { HttpError, isUuid } from "./http";
import { verifyPlace } from "./places";
import { supabaseAdmin } from "./supabase/server";
import { getCachedProfile } from "./taste";

/**
 * Trip pages, recap and privacy: a page for each past trip (/p/[id]), your year in travel
 * (/recap), who sees each past trip, and sharing a planned trip while you're away.
 *
 * Like lib/community.ts, reads of other people's data go through the service role, so every
 * function here decides visibility itself (packages/core/src/privacy.ts) and returns only
 * community-safe fields. Writes use the caller's client or check the caller owns the row.
 */

type DbError = { code?: string; message?: string } | null;
const missingColumn = (e: DbError) => !!e && ["42703", "PGRST204"].includes(e.code ?? "");
const missingTable = (e: DbError) => !!e && ["42P01", "PGRST205"].includes(e.code ?? "");

function check(error: DbError, what: string): void {
  if (!error) return;
  if (missingTable(error) || missingColumn(error)) {
    throw new HttpError(503, "Community features aren't set up yet. Run the community database migrations in Supabase.", "community_off");
  }
  console.error(`pages: ${what} failed`, error.code ?? "", (error.message ?? "").slice(0, 120).replace(/sb_[A-Za-z0-9_]+/g, "[key]"));
  throw new HttpError(500, "Something went wrong. Try again.");
}

/** With the community-loop columns, or without them while that migration hasn't been run. */
async function withLoop<R extends { error: DbError }>(run: (loop: boolean) => PromiseLike<R>): Promise<R> {
  const res = await run(true);
  return missingColumn(res.error) ? run(false) : res;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
interface PastRow {
  id: string;
  user_id: string;
  city: string;
  country_code: string;
  year: number | null;
  month: number | null;
  days: number | null;
  rating: number | null;
  highlights: string | null;
  trip_id: string | null;
  visibility?: Visibility;
  hide_dates?: boolean;
  rank_score?: number | null;
}
const PAST_COLS = "id, user_id, city, country_code, year, month, days, rating, highlights, trip_id";
const pastCols = (loop: boolean): string => (loop ? `${PAST_COLS}, visibility, hide_dates, rank_score` : PAST_COLS);
const toPast = (r: PastRow): PastTrip => ({
  id: r.id,
  city: r.city,
  countryCode: r.country_code,
  year: r.year,
  month: r.month,
  days: r.days,
  rating: r.rating,
  highlights: r.highlights ?? "",
  tripId: r.trip_id,
  visibility: r.visibility ?? "followers",
  hideDates: r.hide_dates ?? false,
});

interface SignalRow {
  past_trip_id: string | null;
  kind: SignalKind;
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  visited_on: string | null;
  rating: number | null;
  liked: boolean | null;
  rank_score?: number | null;
}
const SIGNAL_COLS = "past_trip_id, kind, name, city, lat, lng, visited_on, rating, liked";
const signalCols = (loop: boolean): string => (loop ? `${SIGNAL_COLS}, rank_score` : SIGNAL_COLS);

async function personFor(userId: string): Promise<PersonDTO | null> {
  const { data, error } = await supabaseAdmin().from("community_profiles").select("user_id, handle, display_name, home_city").eq("user_id", userId).maybeSingle();
  check(error, "owner");
  return data ? { userId: data.user_id, handle: data.handle, displayName: data.display_name, homeCity: data.home_city ?? "" } : null;
}

async function follows(viewer: string, owner: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from("follows").select("follower_id").eq("follower_id", viewer).eq("followee_id", owner).maybeSingle();
  check(error, "follows");
  return !!data;
}

// ---------------------------------------------------------------------------
// A past trip's page: /p/[id]
// ---------------------------------------------------------------------------
/** A place someone loved on a trip: never their notes or links (imports can carry booking details). */
export interface LovedPlace {
  kind: SignalKind;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Google's page for the place when we found it, else a Maps search for its name and city. */
  mapsUrl: string;
}

export interface PastTripPage {
  /** As the viewer may see it (no dates when they're hidden). */
  trip: PastTrip;
  /** The owner's community profile; null only when the owner is viewing and hasn't joined. */
  owner: PersonDTO | null;
  loved: LovedPlace[];
  isMe: boolean;
}

const MAX_LOVED = 12;
/** Loved places without coordinates are looked up on Google Places (cached for two weeks), this many per page. */
const MAX_LOOKUPS = 8;
/** "Top by rank_score": the places ranked highest in the owner's own ranking also count as loved. */
const TOP_RANKED = 3;

const mapsSearch = (name: string, city: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${city}`)}`;

/**
 * One past trip, if this viewer may see it: Everyone, anyone; Followers, people who follow the
 * owner; Only me, the owner. Nobody else sees a trip before it's over, or a trip by someone who
 * hasn't joined the community. `lookups: false` skips finding places on the map (link previews).
 */
export async function getPastTripPage(ctx: Ctx, id: string, opts: { lookups?: boolean } = {}): Promise<PastTripPage | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await withLoop((loop) => supabaseAdmin().from("past_trips").select<string, PastRow>(pastCols(loop)).eq("id", id).maybeSingle());
  check(error, "past trip");
  const row = data as PastRow | null;
  if (!row) return null;
  const isMe = !!ctx.user && ctx.user.id === row.user_id;
  const owner = await personFor(row.user_id);
  if (!isMe && !owner) return null;
  const trip = toPast(row);
  if (!isMe) {
    const viewerFollows = trip.visibility === "followers" && !!ctx.user && (await follows(ctx.user.id, row.user_id));
    if (!canSeePastTrip(trip, { isOwner: false, follows: viewerFollows })) return null;
  }
  const loved = await lovedPlaces(row.user_id, row.id, row.city, opts.lookups !== false);
  return { trip: isMe ? trip : pastTripForOthers(trip), owner, loved, isMe };
}

/** The places they loved on this trip: liked, rated 4 or more, or among their top-ranked. Best first. */
async function lovedPlaces(userId: string, pastTripId: string, city: string, lookups: boolean): Promise<LovedPlace[]> {
  const { data, error } = await withLoop((loop) =>
    supabaseAdmin().from("taste_signals").select<string, SignalRow>(signalCols(loop)).eq("past_trip_id", pastTripId).eq("user_id", userId).limit(80),
  );
  if (error) {
    // Taste isn't set up yet: the page still shows the trip.
    if (!missingTable(error)) console.error("pages: loved places failed", error.code ?? "");
    return [];
  }
  const rows = ((data ?? []) as SignalRow[])
    .map((r) => ({ ...r, rankScore: r.rank_score ?? null }))
    .filter((s) => s.kind !== "city" && s.liked !== false && !(s.rating != null && s.rating <= 2));
  const topRanked = new Set(rows.filter((s) => s.rankScore != null).sort(byLoved).slice(0, TOP_RANKED));
  const seen = new Set<string>();
  const picked = rows
    .filter((s) => s.liked === true || (s.rating ?? 0) >= 4 || topRanked.has(s))
    .sort(byLoved)
    .filter((s) => {
      const k = s.name.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_LOVED);

  let budget = lookups ? MAX_LOOKUPS : 0;
  return Promise.all(
    picked.map(async (s): Promise<LovedPlace> => {
      const where = s.city || city;
      const base = { kind: s.kind, name: s.name, lat: s.lat, lng: s.lng, mapsUrl: mapsSearch(s.name, where) };
      if ((s.lat != null && s.lng != null) || budget <= 0) return base;
      budget--;
      try {
        const v = await verifyPlace(s.name, "", where);
        if (!v) return base;
        return { ...base, lat: v.lat ?? null, lng: v.lng ?? null, mapsUrl: v.mapsUrl ?? base.mapsUrl };
      } catch (e) {
        console.error("pages: place lookup failed", (e as Error).message.slice(0, 80));
        return base;
      }
    }),
  );
}

/** Change who sees one of your past trips, or whether its dates show. */
export async function setPastTripPrivacy(ctx: Ctx, id: string, p: { visibility?: Visibility; hideDates?: boolean }): Promise<PastTrip> {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  if (!isUuid(id)) throw new HttpError(404, "That place isn't in your list.");
  const patch = { ...(p.visibility ? { visibility: p.visibility } : {}), ...(p.hideDates !== undefined ? { hide_dates: p.hideDates } : {}) };
  if (!Object.keys(patch).length) throw new HttpError(400, "Some fields are invalid.", "invalid_request");
  const { data, error } = await ctx.db.from("past_trips").update(patch).eq("id", id).eq("user_id", ctx.user.id).select<string, PastRow>(pastCols(true)).maybeSingle();
  if (missingColumn(error)) throw new HttpError(503, "Choosing who sees each trip isn't set up yet. Run the community loop database migration in Supabase.", "community_off");
  check(error, "past trip privacy");
  if (!data) throw new HttpError(404, "That place isn't in your list.");
  return toPast(data as PastRow);
}

// ---------------------------------------------------------------------------
// Planned trips: share while away
// ---------------------------------------------------------------------------
export async function setShareWhileAway(ctx: Ctx, tripId: string, on: boolean): Promise<void> {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  if (!isUuid(tripId)) throw new HttpError(404, "We couldn't find that trip.");
  // Trips are written by the server; the user_id filter keeps this to the caller's own trip.
  const { data, error } = await supabaseAdmin().from("trips").update({ share_while_away: on }).eq("id", tripId).eq("user_id", ctx.user.id).select("id").maybeSingle();
  if (missingColumn(error)) throw new HttpError(503, "Sharing while you're away isn't set up yet. Run the community loop database migration in Supabase.", "community_off");
  check(error, "share while away");
  if (!data) throw new HttpError(404, "We couldn't find that trip.");
}

// ---------------------------------------------------------------------------
// Your year in travel: /recap
// ---------------------------------------------------------------------------
export interface RecapDTO {
  recap: YearRecap;
  /** One line from their taste profile, when they have one. */
  personality: string | null;
  /** Years with trips, newest first (for picking another year). */
  years: number[];
}

/** The signed-in person's own year: their past trips and places only, read with their own client. */
export async function getRecap(ctx: Ctx, year: number): Promise<RecapDTO> {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  const userId = ctx.user.id;
  const [trips, signals, taste] = await Promise.all([
    withLoop((loop) => ctx.db.from("past_trips").select<string, PastRow>(pastCols(loop)).eq("user_id", userId).limit(1000)),
    withLoop((loop) => ctx.db.from("taste_signals").select<string, SignalRow>(signalCols(loop)).eq("user_id", userId).limit(3000)),
    getCachedProfile(userId).catch(() => null),
  ]);
  check(trips.error, "recap trips");
  if (signals.error && !missingTable(signals.error)) console.error("pages: recap places failed", signals.error.code ?? "");
  const list: RecapTrip[] = ((trips.data ?? []) as PastRow[]).map((r) => ({
    id: r.id,
    city: r.city,
    countryCode: r.country_code,
    year: r.year,
    month: r.month,
    days: r.days,
    rating: r.rating,
    rankScore: r.rank_score ?? null,
  }));
  const places: RecapSignal[] = (signals.error ? [] : ((signals.data ?? []) as SignalRow[])).map((s) => ({
    pastTripId: s.past_trip_id,
    kind: s.kind,
    name: s.name,
    city: s.city,
    date: s.visited_on,
    rating: s.rating,
    liked: s.liked,
    rankScore: s.rank_score ?? null,
  }));
  return { recap: yearRecap(list, places, year), personality: travelPersonality(taste?.profile), years: recapYears(list) };
}

/** A year from ?year=, or this one. */
export function recapYear(raw: string | null): number {
  const now = new Date().getUTCFullYear();
  const y = Number(raw);
  return Number.isInteger(y) && y >= 1950 && y <= now + 1 ? y : now;
}
