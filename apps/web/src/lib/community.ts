import {
  cityKey as toCityKey,
  cityLabel,
  hiddenWhileAway,
  publicItinerary,
  rankTravellers,
  topTripScore,
  travelStats,
  visiblePastTrips,
  type CommunityProfileInput,
  type CommunityTrip,
  type Itinerary,
  type LeaderboardRow,
  type MyCommunityProfile,
  type PastTrip,
  type PastTripInput,
  type PersonDTO,
  type ProfileDTO,
  type TripRequest,
  type Visibility,
} from "@travel/core";
import type { Ctx } from "./auth";
import { HttpError, isUuid } from "./http";
import { supabaseAdmin } from "./supabase/server";

/**
 * Community reads of other people's data go through the service role, so every function here
 * decides visibility itself and returns only community-safe fields. Writes use the caller's
 * client (row-level security: people can only change their own rows).
 */

type DbError = { code?: string; message?: string } | null;

/** Tables or columns missing = the community migration hasn't been run yet. */
function check(error: DbError, what: string): void {
  if (!error) return;
  if (["42P01", "42703", "PGRST205", "PGRST204", "42883"].includes(error.code ?? "")) {
    throw new HttpError(503, "Community features aren't set up yet. Run the community database migration in Supabase.", "community_off");
  }
  console.error(`community: ${what} failed`, error.code ?? "", (error.message ?? "").slice(0, 120).replace(/sb_[A-Za-z0-9_]+/g, "[key]"));
  throw new HttpError(500, "Something went wrong loading the community. Try again.");
}

/**
 * Run a query with the columns the community-loop migration adds (who sees each past trip, hidden
 * dates, sharing while away), or without them while that migration hasn't been run.
 */
async function withLoop<R extends { error: DbError }>(run: (loop: boolean) => PromiseLike<R>): Promise<R> {
  const res = await run(true);
  return res.error && ["42703", "PGRST204"].includes(res.error.code ?? "") ? run(false) : res;
}

const isGuest = (ctx: Ctx) => !ctx.user || !!(ctx.user as { is_anonymous?: boolean }).is_anonymous;

export function requireMember(ctx: Ctx): asserts ctx is Ctx & { user: NonNullable<Ctx["user"]> } {
  if (isGuest(ctx)) throw new HttpError(401, "Sign in with your email to join the community.", "needs_email");
}

interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  home_city: string;
  bio: string;
  default_visibility: Visibility;
  places_public: boolean;
}

const person = (r: Pick<ProfileRow, "user_id" | "handle" | "display_name" | "home_city">): PersonDTO => ({
  userId: r.user_id,
  handle: r.handle,
  displayName: r.display_name,
  homeCity: r.home_city ?? "",
});

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
}
const PAST_COLS = "id, user_id, city, country_code, year, month, days, rating, highlights, trip_id";
const pastCols = (loop: boolean): string => (loop ? `${PAST_COLS}, visibility, hide_dates` : PAST_COLS);
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
/** The privacy columns to write: only the ones given (an edit that leaves them out keeps them). */
const privacyCols = (p: Pick<PastTripInput, "visibility" | "hideDates">) => ({
  // Choosing who sees the trip also shares the places loved on it with them.
  ...(p.visibility ? { visibility: p.visibility, places_shared: true } : {}),
  ...(p.hideDates !== undefined ? { hide_dates: p.hideDates } : {}),
});

/** Who sees a new past trip when the person didn't say: everyone if their places are public, else followers. */
async function newPlaceVisibility(ctx: Ctx, p: Pick<PastTripInput, "visibility">): Promise<Visibility> {
  if (p.visibility) return p.visibility;
  if (isGuest(ctx)) return "followers";
  const { data } = await ctx.db.from("community_profiles").select("places_public").eq("user_id", ctx.user!.id).maybeSingle();
  return data?.places_public ? "public" : "followers";
}
const byRecent = (a: PastTrip, b: PastTrip) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0) || a.city.localeCompare(b.city);

// ---------------------------------------------------------------------------
// My profile
// ---------------------------------------------------------------------------
export async function getMyProfile(ctx: Ctx): Promise<MyCommunityProfile | null> {
  if (isGuest(ctx)) return null;
  const { data, error } = await ctx.db.from("community_profiles").select("*").eq("user_id", ctx.user!.id).maybeSingle();
  check(error, "my profile");
  if (!data) return null;
  const r = data as ProfileRow;
  return { ...person(r), bio: r.bio ?? "", defaultVisibility: r.default_visibility, placesPublic: r.places_public };
}

export async function saveMyProfile(ctx: Ctx, input: CommunityProfileInput): Promise<MyCommunityProfile> {
  requireMember(ctx);
  const row = {
    user_id: ctx.user.id,
    handle: input.handle,
    display_name: input.displayName,
    home_city: input.homeCity,
    bio: input.bio,
    default_visibility: input.defaultVisibility,
    places_public: input.placesPublic,
  };
  const { error } = await ctx.db.from("community_profiles").upsert(row, { onConflict: "user_id" });
  if (error?.code === "23505") throw new HttpError(409, "That handle is taken. Try another.", "handle_taken");
  check(error, "save profile");
  return (await getMyProfile(ctx))!;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
async function peopleById(ids: string[]): Promise<Map<string, PersonDTO>> {
  const out = new Map<string, PersonDTO>();
  if (!ids.length) return out;
  const { data, error } = await supabaseAdmin()
    .from("community_profiles")
    .select("user_id, handle, display_name, home_city")
    .in("user_id", [...new Set(ids)]);
  check(error, "people");
  for (const r of data ?? []) out.set(r.user_id, person(r));
  return out;
}

async function followingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from("follows").select("followee_id").eq("follower_id", userId).limit(2000);
  check(error, "following");
  return (data ?? []).map((r) => r.followee_id as string);
}

export async function searchPeople(ctx: Ctx, q: string): Promise<(PersonDTO & { iFollow: boolean })[]> {
  // Letters, numbers, spaces, apostrophes and hyphens only: the term goes into a PostgREST filter.
  const term = q.replace(/[^\p{L}\p{N} '-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const admin = supabaseAdmin();
  let rows: Pick<ProfileRow, "user_id" | "handle" | "display_name" | "home_city">[] = [];
  if (term) {
    // Handles are a-z0-9_ only. A name in another script ("محمد", "李") leaves nothing to match a
    // handle on, and an empty "handle.ilike.%%" would match everyone: search names alone then.
    const handleTerm = term.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const filters = [handleTerm ? `handle.ilike.%${handleTerm}%` : "", `display_name.ilike.%${term}%`].filter(Boolean).join(",");
    const { data, error } = await admin
      .from("community_profiles")
      .select("user_id, handle, display_name, home_city")
      .or(filters)
      .limit(20);
    check(error, "search");
    rows = data ?? [];
  } else if (!isGuest(ctx)) {
    // No query: suggest people who follow me that I don't follow back.
    const { data, error } = await admin.from("follows").select("follower_id").eq("followee_id", ctx.user!.id).limit(200);
    check(error, "suggestions");
    const mine = new Set(await followingIds(ctx.user!.id));
    const ids = (data ?? []).map((r) => r.follower_id as string).filter((id) => !mine.has(id));
    const map = await peopleById(ids.slice(0, 20));
    return [...map.values()].map((p) => ({ ...p, iFollow: false }));
  }
  const mine = isGuest(ctx) ? new Set<string>() : new Set(await followingIds(ctx.user!.id));
  return rows.filter((r) => r.user_id !== ctx.user?.id).map((r) => ({ ...person(r), iFollow: mine.has(r.user_id) }));
}

export async function follow(ctx: Ctx, handle: string, on: boolean) {
  requireMember(ctx);
  const me = await getMyProfile(ctx);
  if (!me) throw new HttpError(400, "Create your community profile first.", "needs_profile");
  const { data: target, error } = await supabaseAdmin().from("community_profiles").select("user_id").eq("handle", handle.toLowerCase()).maybeSingle();
  check(error, "follow target");
  if (!target) throw new HttpError(404, "We couldn't find that person.");
  if (target.user_id === ctx.user.id) throw new HttpError(400, "You can't follow yourself.");
  const res = on
    ? await ctx.db.from("follows").upsert({ follower_id: ctx.user.id, followee_id: target.user_id }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true })
    : await ctx.db.from("follows").delete().eq("follower_id", ctx.user.id).eq("followee_id", target.user_id);
  check(res.error, "follow");
}

// ---------------------------------------------------------------------------
// Places I've been
// ---------------------------------------------------------------------------
export async function myPlaces(ctx: Ctx): Promise<PastTrip[]> {
  if (!ctx.user) return [];
  const userId = ctx.user.id;
  const { data, error } = await withLoop((loop) => ctx.db.from("past_trips").select<string, PastRow>(pastCols(loop)).eq("user_id", userId).limit(1000));
  check(error, "my places");
  return (data as PastRow[]).map(toPast).sort(byRecent);
}

export async function addPlace(ctx: Ctx, p: PastTripInput): Promise<PastTrip> {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  if (p.tripId) {
    const { data: own } = await ctx.db.from("trips").select("id").eq("id", p.tripId).maybeSingle();
    if (!own) throw new HttpError(404, "That trip isn't yours.");
  }
  const row = {
    user_id: ctx.user.id,
    city: p.city,
    city_key: toCityKey(p.city),
    country_code: p.countryCode,
    year: p.year,
    month: p.month,
    days: p.days,
    rating: p.rating,
    highlights: p.highlights,
    trip_id: p.tripId,
  };
  const privacy = privacyCols({ ...p, visibility: await newPlaceVisibility(ctx, p) });
  const { data, error } = await withLoop((loop) =>
    ctx.db
      .from("past_trips")
      .insert(loop ? { ...row, ...privacy } : row)
      .select<string, PastRow>(pastCols(loop))
      .single(),
  );
  if (error?.code === "23505") throw new HttpError(409, "You've already logged this trip.", "duplicate");
  check(error, "add place");
  return toPast(data as PastRow);
}

/**
 * Add many past trips (an import). Ones already logged for the same city and year are skipped,
 * except that a longer stay found now raises their days (`updated`, counted in `skipped` too).
 */
export async function addPlacesBulk(ctx: Ctx, list: PastTripInput[]): Promise<{ added: number; skipped: number; updated: number }> {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  const { data: have } = await ctx.db.from("past_trips").select("id, city_key, year, days").eq("user_id", ctx.user.id).limit(1000);
  const existing = new Map((have ?? []).map((r) => [`${r.city_key}|${r.year ?? ""}`, r as { id: string; days: number | null }]));
  const seen = new Set(existing.keys());
  const rows: { row: Record<string, unknown>; privacy: Record<string, unknown> }[] = [];
  // Already logged, but an import found a longer stay (an earlier photo scan counted trips as a
  // day or two): the longer count is the better one.
  const longer = new Map<string, number>();
  const fallback = await newPlaceVisibility(ctx, {});
  for (const p of list) {
    const key = `${toCityKey(p.city)}|${p.year ?? ""}`;
    const had = existing.get(key);
    if (had && p.days && p.days > Math.max(had.days ?? 0, longer.get(had.id) ?? 0)) longer.set(had.id, p.days);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      row: { user_id: ctx.user.id, city: p.city, city_key: toCityKey(p.city), country_code: p.countryCode, year: p.year, month: p.month, days: p.days, rating: p.rating, highlights: p.highlights },
      privacy: privacyCols({ ...p, visibility: p.visibility ?? fallback }),
    });
  }
  if (rows.length) {
    const { error } = await withLoop((loop) => ctx.db.from("past_trips").insert(rows.map((r) => (loop ? { ...r.row, ...r.privacy } : r.row))));
    check(error, "add places");
  }
  const userId = ctx.user.id;
  const fixes = [...longer];
  for (let i = 0; i < fixes.length; i += 10) {
    const results = await Promise.all(fixes.slice(i, i + 10).map(([id, days]) => ctx.db.from("past_trips").update({ days }).eq("id", id).eq("user_id", userId)));
    for (const { error } of results) check(error, "update place length");
  }
  return { added: rows.length, skipped: list.length - rows.length, updated: longer.size };
}

export async function updatePlace(ctx: Ctx, id: string, p: PastTripInput): Promise<PastTrip> {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  const userId = ctx.user.id;
  const patch = { city: p.city, city_key: toCityKey(p.city), country_code: p.countryCode, year: p.year, month: p.month, days: p.days, rating: p.rating, highlights: p.highlights };
  const { data, error } = await withLoop((loop) =>
    ctx.db
      .from("past_trips")
      .update(loop ? { ...patch, ...privacyCols(p) } : patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select<string, PastRow>(pastCols(loop))
      .maybeSingle(),
  );
  check(error, "update place");
  if (!data) throw new HttpError(404, "That place isn't in your list.");
  return toPast(data as PastRow);
}

export async function deletePlace(ctx: Ctx, id: string) {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  const { error } = await ctx.db.from("past_trips").delete().eq("id", id).eq("user_id", ctx.user.id);
  check(error, "delete place");
}

async function placesFor(userIds: string[]): Promise<Map<string, PastTrip[]>> {
  const out = new Map<string, PastTrip[]>(userIds.map((id) => [id, []]));
  if (!userIds.length) return out;
  const { data, error } = await withLoop((loop) => supabaseAdmin().from("past_trips").select<string, PastRow>(pastCols(loop)).in("user_id", userIds).limit(20000));
  check(error, "places");
  for (const r of (data ?? []) as PastRow[]) out.get(r.user_id)?.push(toPast(r));
  return out;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export async function getProfile(ctx: Ctx, handle: string): Promise<{ profile: ProfileDTO; trips: CommunityTrip[] } | null> {
  const admin = supabaseAdmin();
  const { data: p, error } = await admin.from("community_profiles").select("*").eq("handle", handle.toLowerCase()).maybeSingle();
  check(error, "profile");
  if (!p) return null;
  const r = p as ProfileRow;
  const viewer = ctx.user?.id ?? null;
  const isMe = viewer === r.user_id;

  const [followers, following, rel, places] = await Promise.all([
    admin.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", r.user_id),
    admin.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", r.user_id),
    viewer && !isMe
      ? admin.from("follows").select("follower_id, followee_id").or(`and(follower_id.eq.${viewer},followee_id.eq.${r.user_id}),and(follower_id.eq.${r.user_id},followee_id.eq.${viewer})`)
      : Promise.resolve({ data: [] as { follower_id: string; followee_id: string }[], error: null }),
    placesFor([r.user_id]),
  ]);
  check(followers.error ?? following.error ?? rel.error, "profile counts");
  const iFollow = !!rel.data?.some((x) => x.follower_id === viewer);
  const followsMe = !!rel.data?.some((x) => x.follower_id === r.user_id);
  const list = (places.get(r.user_id) ?? []).sort(byRecent);
  // Each past trip says who sees it (counts include them all); ones still ahead stay hidden.
  const shown = visiblePastTrips(list, { isOwner: isMe, follows: iFollow });

  const profile: ProfileDTO = {
    ...person(r),
    bio: r.bio ?? "",
    followers: followers.count ?? 0,
    following: following.count ?? 0,
    stats: travelStats(list),
    places: isMe || iFollow || shown.length ? shown : null,
    isMe,
    iFollow,
    followsMe,
  };
  const levels: Visibility[] = isMe || iFollow ? ["public", "followers"] : ["public"];
  const trips = await tripList(ctx, (q) => q.eq("user_id", r.user_id).in("visibility", levels).order("created_at", { ascending: false }).limit(30));
  return { profile, trips };
}

// ---------------------------------------------------------------------------
// Trips as the community sees them
// ---------------------------------------------------------------------------
interface CTripRow {
  id: string;
  user_id: string;
  title: string;
  destination: string;
  city_key: string | null;
  request: TripRequest;
  itinerary: Itinerary;
  rating: number;
  likes_count: number;
  visibility: Visibility;
  created_at: string;
  share_while_away?: boolean;
}
const CTRIP_COLS = "id, user_id, title, destination, city_key, request, itinerary, rating, likes_count, visibility, created_at";
const tripCols = (loop: boolean): string => (loop ? `${CTRIP_COLS}, share_while_away` : CTRIP_COLS);
/** Dated trips stay hidden from everyone but their owner until the day after they end (unless shared while away). */
const awayFrom = (ctx: Ctx, r: { user_id: string; request?: Partial<TripRequest> | null; share_while_away?: boolean }) =>
  r.user_id !== ctx.user?.id && hiddenWhileAway({ request: r.request, shareWhileAway: r.share_while_away });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

async function tripList(ctx: Ctx, build: (q: Q) => Q, withItinerary = false): Promise<CommunityTrip[]> {
  const { data, error } = await withLoop<{ data: unknown[] | null; error: DbError }>((loop) => build(supabaseAdmin().from("trips").select(tripCols(loop))));
  check(error, "trips");
  const rows = ((data ?? []) as CTripRow[]).filter((r) => !awayFrom(ctx, r));
  if (!rows.length) return [];
  const [people, liked] = await Promise.all([peopleById(rows.map((r) => r.user_id)), likedSet(ctx, rows.map((r) => r.id))]);
  // Only trips by community members are shown to others.
  return rows
    .filter((r) => people.has(r.user_id))
    .map((r) => toCommunityTrip(r, people.get(r.user_id)!, liked.has(r.id), withItinerary));
}

function toCommunityTrip(r: CTripRow, owner: PersonDTO, iLiked: boolean, withItinerary: boolean): CommunityTrip {
  const req = r.request ?? ({} as Partial<TripRequest>);
  return {
    id: r.id,
    title: r.title,
    destination: r.destination,
    cityKey: r.city_key || toCityKey(r.destination),
    days: r.itinerary?.days?.length ?? req.days ?? 0,
    party: req.party ?? "",
    pace: req.pace ?? "",
    budget: req.budget ?? "",
    interests: req.interests ?? [],
    hasHotels: (r.itinerary?.hotels?.length ?? 0) > 0,
    likes: r.likes_count ?? 0,
    ownerRating: r.rating ?? 0,
    iLiked,
    visibility: r.visibility,
    createdAt: r.created_at,
    owner,
    ...(withItinerary ? { itinerary: publicItinerary(r.itinerary, r.request) } : {}),
  };
}

async function likedSet(ctx: Ctx, tripIds: string[]): Promise<Set<string>> {
  if (!ctx.user || !tripIds.length) return new Set();
  const { data, error } = await supabaseAdmin().from("trip_likes").select("trip_id").eq("user_id", ctx.user.id).in("trip_id", tripIds);
  check(error, "likes");
  return new Set((data ?? []).map((r) => r.trip_id as string));
}

/** Can this viewer see this trip? Mirrors public.can_view_trip in the database. */
async function canView(ctx: Ctx, r: Pick<CTripRow, "user_id" | "visibility" | "request" | "share_while_away">): Promise<boolean> {
  if (ctx.user?.id === r.user_id) return true;
  if (awayFrom(ctx, r)) return false;
  if (r.visibility === "public") return true;
  if (r.visibility !== "followers" || !ctx.user) return false;
  const { data } = await supabaseAdmin().from("follows").select("follower_id").eq("follower_id", ctx.user.id).eq("followee_id", r.user_id).maybeSingle();
  return !!data;
}

export async function getCommunityTrip(ctx: Ctx, id: string): Promise<CommunityTrip | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await withLoop((loop) => supabaseAdmin().from("trips").select<string, CTripRow>(tripCols(loop)).eq("id", id).maybeSingle());
  check(error, "trip");
  const r = data as CTripRow | null;
  if (!r || !(await canView(ctx, r))) return null;
  const owner = (await peopleById([r.user_id])).get(r.user_id);
  if (!owner) return null;
  return toCommunityTrip(r, owner, (await likedSet(ctx, [r.id])).has(r.id), true);
}

export async function feed(ctx: Ctx): Promise<CommunityTrip[]> {
  if (!ctx.user) return [];
  const ids = await followingIds(ctx.user.id);
  if (!ids.length) return [];
  return tripList(ctx, (q) => q.in("user_id", ids).in("visibility", ["public", "followers"]).order("created_at", { ascending: false }).limit(40));
}

export async function topCities(): Promise<{ key: string; label: string; trips: number }[]> {
  const cols = "city_key, destination, user_id, start_date:request->>startDate, trip_days:request->days";
  const { data, error } = await withLoop((loop) =>
    supabaseAdmin()
      .from("trips")
      .select<string, Record<string, unknown>>(loop ? `${cols}, share_while_away` : cols)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(3000),
  );
  check(error, "cities");
  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (r) => !hiddenWhileAway({ request: { startDate: r.start_date as string | null, days: Number(r.trip_days) || 1 }, shareWhileAway: r.share_while_away as boolean | undefined }),
  );
  const members = await peopleById(rows.map((r) => r.user_id as string));
  const counts = new Map<string, { label: string; trips: number }>();
  for (const r of rows) {
    if (!members.has(r.user_id as string)) continue;
    const key = (r.city_key as string) || toCityKey(r.destination as string);
    if (!key) continue;
    const cur = counts.get(key) ?? { label: (r.destination as string).split(",")[0]!.trim() || cityLabel(key), trips: 0 };
    cur.trips++;
    counts.set(key, cur);
  }
  return [...counts.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.trips - a.trips || a.label.localeCompare(b.label)).slice(0, 24);
}

export async function topTrips(ctx: Ctx, city: string): Promise<CommunityTrip[]> {
  const key = toCityKey(city);
  const trips = await tripList(ctx, (q) => {
    let qq = q.eq("visibility", "public");
    if (key) qq = qq.eq("city_key", key);
    return qq.order("likes_count", { ascending: false }).order("rating", { ascending: false }).order("created_at", { ascending: false }).limit(80);
  });
  const now = Date.now();
  return trips.sort((a, b) => topTripScore(b, now) - topTripScore(a, now)).slice(0, 20);
}

export async function setLike(ctx: Ctx, tripId: string, on: boolean): Promise<number> {
  requireMember(ctx);
  const t = await getCommunityTrip(ctx, tripId);
  if (!t) throw new HttpError(404, "We couldn't find that trip.");
  if (t.owner.userId === ctx.user.id) throw new HttpError(400, "You can't like your own trip.");
  const res = on
    ? await ctx.db.from("trip_likes").upsert({ user_id: ctx.user.id, trip_id: tripId }, { onConflict: "user_id,trip_id", ignoreDuplicates: true })
    : await ctx.db.from("trip_likes").delete().eq("user_id", ctx.user.id).eq("trip_id", tripId);
  check(res.error, "like");
  const { data } = await supabaseAdmin().from("trips").select("likes_count").eq("id", tripId).maybeSingle();
  return data?.likes_count ?? t.likes;
}

export async function setVisibility(ctx: Ctx, tripId: string, visibility: Visibility) {
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  if (!isUuid(tripId)) throw new HttpError(404, "We couldn't find that trip.");
  if (visibility !== "private") {
    requireMember(ctx);
    if (!(await getMyProfile(ctx))) throw new HttpError(400, "Create your community profile first, then you can share trips.", "needs_profile");
  }
  // Trips are written by the server; the user_id filter keeps this to the caller's own trip.
  const { data, error } = await supabaseAdmin().from("trips").update({ visibility }).eq("id", tripId).eq("user_id", ctx.user.id).select("id").maybeSingle();
  check(error, "visibility");
  if (!data) throw new HttpError(404, "We couldn't find that trip.");
}

// ---------------------------------------------------------------------------
// Leaderboard: me and the people I follow
// ---------------------------------------------------------------------------
export async function leaderboard(ctx: Ctx): Promise<LeaderboardRow[]> {
  if (isGuest(ctx)) return [];
  const me = await getMyProfile(ctx);
  const ids = [...new Set([...(me ? [ctx.user!.id] : []), ...(await followingIds(ctx.user!.id))])];
  if (!ids.length) return [];
  const [people, places] = await Promise.all([peopleById(ids), placesFor(ids)]);
  const rows = ids
    .filter((id) => people.has(id))
    .map((id) => ({ person: people.get(id)!, stats: travelStats(places.get(id) ?? []), isMe: id === ctx.user!.id }));
  return rankTravellers(rows).map(({ rank, ...r }) => ({ ...r, rank }));
}
