import {
  askPlacesFrom,
  cityKey,
  countryName,
  creditSummary,
  friendCandidates,
  inEastJerusalem,
  isFutureDay,
  isFutureTrip,
  isLocalFor,
  isLoved,
  localExpertCities,
  lovedRankThreshold,
  regionPolicy,
  tripWhen,
  type BeenFriend,
  type Candidate,
  type FriendCredit,
  type FriendPlace,
  type FriendsMe,
  type Itinerary,
  type LikeTrip,
  type PersonDTO,
  type SignalKind,
} from "@travel/core";
import type { Ctx } from "./auth";
import { HttpError, isUuid } from "./http";
import { supabaseAdmin } from "./supabase/server";

/**
 * Friends who've been: friends' loved places as a planner source, the friends to ask about a
 * city, local experts, "Plan a trip like this", and credit when someone's picks helped.
 *
 * Other people's rows are read with the service role, so every function here filters them
 * itself: friends are people who follow each other; their places are used only when they have
 * "Let friends' planners use places I loved" on (picks_for_friends), only from past trips that
 * aren't private, and never from trips (or visits) dated in the future. Until the community-loop
 * migration has been run, everything here returns nothing rather than failing.
 */

type DbError = { code?: string; message?: string } | null;
const MISSING = ["42P01", "42703", "PGRST205", "PGRST204", "42883"];
/** A table or column the community-loop migration adds isn't there yet. */
export const isMissing = (e: DbError) => !!e && MISSING.includes(e.code ?? "");
export const FRIENDS_OFF = "Friends' picks aren't set up yet. Run the community loop database migration in Supabase.";

function logFail(what: string, e: DbError) {
  if (e && !isMissing(e)) console.error(`friends: ${what} failed`, e.code ?? "", (e.message ?? "").slice(0, 120).replace(/sb_[A-Za-z0-9_]+/g, "[key]"));
}

export const isGuest = (ctx: Ctx) => !ctx.user || !!(ctx.user as { is_anonymous?: boolean }).is_anonymous;

// ---------------------------------------------------------------------------
// Friends (people who follow each other)
// ---------------------------------------------------------------------------
export async function friendIds(userId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const [{ data: out, error: e1 }, { data: inc, error: e2 }] = await Promise.all([
    db.from("follows").select("followee_id").eq("follower_id", userId).limit(1000),
    db.from("follows").select("follower_id").eq("followee_id", userId).limit(1000),
  ]);
  if (e1 || e2) {
    logFail("follows", e1 ?? e2);
    return [];
  }
  const followsMe = new Set((inc ?? []).map((r) => r.follower_id as string));
  return (out ?? []).map((r) => r.followee_id as string).filter((id) => followsMe.has(id) && id !== userId);
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const { data } = await supabaseAdmin()
    .from("follows")
    .select("follower_id")
    .or(`and(follower_id.eq.${a},followee_id.eq.${b}),and(follower_id.eq.${b},followee_id.eq.${a})`);
  return (data ?? []).length === 2;
}

interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  home_city: string | null;
  picks_for_friends?: boolean;
}

export const toPerson = (r: Pick<ProfileRow, "user_id" | "handle" | "display_name" | "home_city">): PersonDTO => ({
  userId: r.user_id,
  handle: r.handle,
  displayName: r.display_name,
  homeCity: r.home_city ?? "",
});

/** Community profiles by user id. */
export async function profilesById(ids: string[]): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>();
  if (!ids.length) return out;
  const { data, error } = await supabaseAdmin().from("community_profiles").select("user_id, handle, display_name, home_city").in("user_id", [...new Set(ids)]);
  logFail("profiles", error);
  for (const r of (data ?? []) as ProfileRow[]) out.set(r.user_id, r);
  return out;
}

/** Friends who let friends' planners use their places. Null before the migration (the setting isn't there to check). */
async function sharingFriends(ids: string[]): Promise<Map<string, ProfileRow> | null> {
  const out = new Map<string, ProfileRow>();
  if (!ids.length) return out;
  const { data, error } = await supabaseAdmin()
    .from("community_profiles")
    .select("user_id, handle, display_name, home_city, picks_for_friends")
    .in("user_id", ids)
    .eq("picks_for_friends", true);
  if (error) {
    logFail("sharing friends", error);
    return null;
  }
  for (const r of (data ?? []) as ProfileRow[]) out.set(r.user_id, r);
  return out;
}

// ---------------------------------------------------------------------------
// Past trips and the places loved on them
// ---------------------------------------------------------------------------
interface PastRow {
  id: string;
  user_id: string;
  city: string;
  city_key: string;
  country_code: string;
  year: number | null;
  month: number | null;
  visibility: string;
  hide_dates: boolean;
  places_shared: boolean;
}
const PAST_COLS = "id, user_id, city, city_key, country_code, year, month, visibility, hide_dates, places_shared";

/** People's past trips in a city that their friends may see: not private, not dated in the future. Null before the migration. */
async function visibleTripsIn(userIds: string[], key: string): Promise<PastRow[] | null> {
  if (!userIds.length || !key) return [];
  const { data, error } = await supabaseAdmin().from("past_trips").select(PAST_COLS).in("user_id", userIds).eq("city_key", key).neq("visibility", "private").limit(1000);
  if (error) {
    logFail("past trips", error);
    return null;
  }
  return ((data ?? []) as PastRow[]).filter((t) => t.visibility !== "private" && !isFutureTrip(t));
}

interface SignalRow {
  id: string;
  user_id: string;
  past_trip_id: string | null;
  kind: SignalKind;
  name: string;
  lat: number | null;
  lng: number | null;
  visited_on: string | null;
  rating: number | null;
  liked: boolean | null;
  rank_score?: number | null;
}
// No notes: a friend's own notes are for them, not for other people's planners.
const SIGNAL_COLS = "id, user_id, past_trip_id, kind, name, lat, lng, visited_on, rating, liked";

/** Each person's "loved" bar for their own ranking (their top third), when the ranking is there. */
async function rankThresholds(userIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (!userIds.length) return out;
  const { data, error } = await supabaseAdmin().from("taste_signals").select("user_id, rank_score").in("user_id", userIds).not("rank_score", "is", null).limit(5000);
  if (error) {
    logFail("rank scores", error);
    return out;
  }
  const by = new Map<string, number[]>();
  for (const r of data ?? []) by.set(r.user_id as string, [...(by.get(r.user_id as string) ?? []), r.rank_score as number]);
  for (const [u, s] of by) out.set(u, lovedRankThreshold(s));
  return out;
}

/**
 * The places loved on these past trips, by person, best first: only signals tied to one of the
 * trips (and owned by the trip's owner), no cities, no visits dated in the future.
 */
async function lovedOn(trips: PastRow[]): Promise<Map<string, SignalRow[]>> {
  const out = new Map<string, SignalRow[]>();
  if (!trips.length) return out;
  // Only trips whose owner shares the places loved on them (older trips start hidden).
  const owner = new Map(trips.filter((t) => t.places_shared).map((t) => [t.id, t.user_id]));
  if (!owner.size) return out;
  const db = supabaseAdmin();
  const ids = [...owner.keys()];
  let { data, error }: { data: unknown[] | null; error: DbError } = await db.from("taste_signals").select(`${SIGNAL_COLS}, rank_score`).in("past_trip_id", ids).limit(3000);
  // Before the ranking column exists: the same, without it.
  if (error && isMissing(error)) ({ data, error } = await db.from("taste_signals").select(SIGNAL_COLS).in("past_trip_id", ids).limit(3000));
  if (error) {
    logFail("loved places", error);
    return out;
  }
  const rows = ((data ?? []) as SignalRow[]).filter((s) => s.past_trip_id && owner.get(s.past_trip_id) === s.user_id && s.kind !== "city" && !isFutureDay(s.visited_on));
  const bars = await rankThresholds([...new Set(rows.map((r) => r.user_id))]);
  for (const s of rows) {
    if (!isLoved({ liked: s.liked, rating: s.rating, rankScore: s.rank_score }, bars.get(s.user_id) ?? null)) continue;
    out.set(s.user_id, [...(out.get(s.user_id) ?? []), s]);
  }
  for (const [u, list] of out) {
    const seen = new Set<string>();
    out.set(
      u,
      list
        .sort((a, b) => (b.rank_score ?? -Infinity) - (a.rank_score ?? -Infinity) || (b.rating ?? 0) - (a.rating ?? 0) || Number(!!b.liked) - Number(!!a.liked))
        .filter((s) => {
          const k = s.name.trim().toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }),
    );
  }
  return out;
}

interface CityFriends {
  people: Map<string, ProfileRow>;
  trips: PastRow[];
  loved: Map<string, SignalRow[]>;
  local: (userId: string) => boolean;
}

/** A person's friends as they relate to one city: who shares, their visible trips there, what they loved. Null before the migration. */
async function friendsInCity(userId: string, city: string): Promise<CityFriends | null> {
  const key = cityKey(city);
  const people = await sharingFriends(await friendIds(userId));
  if (!people) return null;
  const trips = await visibleTripsIn([...people.keys()], key);
  if (!trips) return null;
  const loved = await lovedOn(trips);
  const local = (u: string) => isLocalFor(city, { homeCity: people.get(u)?.home_city, trips: trips.filter((t) => t.user_id === u) });
  return { people, trips, loved, local };
}

/** "Friends who've been": friends with a visible trip there, or who live there, locals first. */
export async function friendsWhoveBeen(ctx: Ctx, city: string): Promise<BeenFriend[]> {
  if (isGuest(ctx) || !cityKey(city)) return [];
  const f = await friendsInCity(ctx.user!.id, city);
  if (!f) return [];
  const key = cityKey(city);
  const out: BeenFriend[] = [];
  for (const [u, p] of f.people) {
    const trips = f.trips
      .filter((t) => t.user_id === u)
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0));
    const lives = !!p.home_city && cityKey(p.home_city) === key;
    if (!trips.length && !lives) continue;
    out.push({
      person: toPerson(p),
      local: f.local(u),
      trips: trips.map((t) => ({ when: tripWhen({ year: t.year, month: t.month, hideDates: t.hide_dates }) })),
      loved: (f.loved.get(u) ?? []).slice(0, 8).map((s) => ({ name: s.name, kind: s.kind })),
    });
  }
  return out
    .sort((a, b) => Number(b.local) - Number(a.local) || b.loved.length - a.loved.length || b.trips.length - a.trips.length || a.person.displayName.localeCompare(b.person.displayName))
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// "Plan a trip like this"
// ---------------------------------------------------------------------------
interface LikeResolved {
  id: string;
  ownerId: string;
  ownerName: string;
  city: string;
  cityKey: string;
  destination: string;
  mine: boolean;
  local: boolean;
  /** Its loved places go to the planner: not your own trip (your taste is already there), and the owner shares with friends. */
  placesAllowed: boolean;
  loved: SignalRow[];
}

async function follows(follower: string, followee: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("follows").select("follower_id").eq("follower_id", follower).eq("followee_id", followee).maybeSingle();
  return !!data;
}

/**
 * A past trip someone may plan one like: their own; a public one; or a followers-only one when
 * they follow its owner. Anyone else's must belong to a community member. Null otherwise.
 */
async function resolveLike(viewerId: string | null, id: string): Promise<LikeResolved | null> {
  if (!isUuid(id)) return null;
  const db = supabaseAdmin();
  const { data, error } = await db.from("past_trips").select(PAST_COLS).eq("id", id).maybeSingle();
  if (error || !data) {
    logFail("plan like", error);
    return null;
  }
  const t = data as PastRow;
  const mine = !!viewerId && viewerId === t.user_id;
  // Nobody else sees a trip before it's over.
  if (!mine && isFutureTrip(t)) return null;
  if (!mine) {
    const ok = t.visibility === "public" || (t.visibility === "followers" && !!viewerId && (await follows(viewerId, t.user_id)));
    if (!ok) return null;
  }
  const { data: p, error: pErr } = await db.from("community_profiles").select("user_id, handle, display_name, home_city, picks_for_friends").eq("user_id", t.user_id).maybeSingle();
  logFail("plan like owner", pErr);
  const owner = p as ProfileRow | null;
  if (!mine && !owner) return null;
  const sharing = owner?.picks_for_friends === true;
  const placesAllowed = !mine && sharing && !isFutureTrip(t);
  const [loved, cityTrips] = placesAllowed ? await Promise.all([lovedOn([t]), visibleTripsIn([t.user_id], t.city_key)]) : [new Map<string, SignalRow[]>(), [] as PastRow[]];
  return {
    id: t.id,
    ownerId: t.user_id,
    ownerName: owner?.display_name ?? "",
    city: t.city,
    cityKey: t.city_key || cityKey(t.city),
    destination: `${t.city}, ${countryName(t.country_code)}`,
    mine,
    local: isLocalFor(t.city, { homeCity: owner?.home_city, trips: cityTrips ?? [] }),
    placesAllowed,
    loved: loved.get(t.user_id) ?? [],
  };
}

/** For the planner: the trip to prefill from, or null if this viewer can't see it. */
export async function likeTrip(ctx: Ctx, id: string): Promise<LikeTrip | null> {
  const r = await resolveLike(ctx.user?.id ?? null, id);
  return r ? { id: r.id, city: r.city, destination: r.destination, ownerName: r.mine ? "" : r.ownerName, mine: r.mine } : null;
}

// ---------------------------------------------------------------------------
// The friends source: candidates for the planner, and credit afterwards
// ---------------------------------------------------------------------------
export interface FriendSource {
  /** Friends' places in this city, as planner candidates (none for guests or people without friends). */
  candidates(destination: string, staysOnly?: boolean): Promise<Candidate[]>;
  /** Credit the friends whose picks made it into this trip (and the trip it was planned like). Best effort. */
  credit<T extends { id: string; user_id: string; itinerary: Itinerary }>(trip: T): Promise<T>;
}

interface AnswerRow {
  id: string;
  friend_id: string;
  answer_places: unknown;
}

/** The places in friends' answers to this person's questions about a city. */
async function answeredPlaces(askerId: string, key: string): Promise<AnswerRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("asks")
    .select("id, friend_id, answer_places")
    .eq("asker_id", askerId)
    .eq("city_key", key)
    .eq("status", "answered")
    .order("answered_at", { ascending: false })
    .limit(30);
  logFail("answers", error);
  return (data ?? []) as AnswerRow[];
}

/**
 * The friends source for one trip's owner. `tripId`: an existing trip (edits). `like`: a past
 * trip id from "Plan a trip like this" (checked here, ignored when the owner can't see it).
 */
export function friendSource(ownerId: string, opts: { guest?: boolean; like?: string | null } = {}): FriendSource {
  const produced = new Map<string, { credits: FriendCredit[]; cityKey: string }>();
  const like = opts.like ? resolveLike(ownerId, opts.like).catch(() => null) : Promise.resolve(null);
  const byCity = new Map<string, Promise<Candidate[]>>();

  async function load(destination: string): Promise<Candidate[]> {
    const key = cityKey(destination);
    if (!key) return [];
    // Guests have no friends (they can't join the community), but can plan like a public trip.
    const none: CityFriends = { people: new Map(), trips: [], loved: new Map(), local: () => false };
    const [f, answers, lk] = await Promise.all([
      opts.guest ? none : friendsInCity(ownerId, destination),
      opts.guest ? ([] as AnswerRow[]) : answeredPlaces(ownerId, key),
      like,
    ]);
    if (!f) return []; // before the migration: nothing to filter by, so nothing at all
    const answerers = await profilesById(answers.map((a) => a.friend_id).filter((u) => !f.people.has(u)));
    const nameOf = (u: string) => f.people.get(u)?.display_name ?? answerers.get(u)?.display_name ?? "";
    const localOf = (u: string) => f.people.has(u) ? f.local(u) : isLocalFor(destination, { homeCity: answerers.get(u)?.home_city, trips: [] });
    type P = FriendPlace & { lng?: number | null; known?: boolean };
    const places: P[] = [];
    if (lk?.placesAllowed && lk.cityKey === key) {
      const credit: FriendCredit = { userId: lk.ownerId, name: lk.ownerName, local: lk.local, from: "like" };
      for (const s of lk.loved) places.push({ credit, name: s.name, kind: s.kind, note: null, lng: s.lng, known: s.lng != null });
    }
    for (const a of answers) {
      const name = nameOf(a.friend_id);
      if (!name || a.friend_id === ownerId) continue;
      const credit: FriendCredit = { userId: a.friend_id, name, local: localOf(a.friend_id), from: "ask" };
      for (const p of askPlacesFrom(a.answer_places)) places.push({ credit, name: p.name, kind: p.kind, note: p.note, known: false });
    }
    for (const [u, list] of f.loved) {
      const credit: FriendCredit = { userId: u, name: nameOf(u), local: f.local(u), from: "loved" };
      for (const s of list.slice(0, 20)) places.push({ credit, name: s.name, kind: s.kind, note: null, lng: s.lng, known: s.lng != null });
    }
    // Jerusalem trips use only Palestinian businesses in East Jerusalem and the Old City (region.ts):
    // a friend's place counts there only if it's known to be east of the line.
    const usable = regionPolicy(destination) === "jerusalem" ? places.filter((p) => p.known && inEastJerusalem({ verification: { lng: p.lng ?? undefined } })) : places;
    // At most 20 a city, so friends' places don't crowd the sights and everything else off the shortlist.
    return friendCandidates(usable, destination, { max: 20 });
  }

  return {
    async candidates(destination, staysOnly = false) {
      const key = cityKey(destination);
      let job = byCity.get(key);
      if (!job) {
        job = load(destination).catch((e) => {
          console.error("friends' candidates failed", e);
          return [] as Candidate[];
        });
        byCity.set(key, job);
      }
      const all = await job;
      for (const c of all) produced.set(c.id, { credits: c.friends ?? [], cityKey: key });
      return staysOnly ? all.filter((c) => c.category === "stay") : all;
    },

    async credit(trip) {
      if (opts.guest) return trip; // credits are for people in the community
      try {
        const rows = new Map<string, { owner_id: string; beneficiary_id: string; kind: string; ref: string; city_key: string }>();
        const add = (owner: string, kind: string, ref: string, city: string) => {
          if (owner && owner !== trip.user_id) rows.set(`${owner}|${kind}|${ref}`, { owner_id: owner, beneficiary_id: trip.user_id, kind, ref, city_key: city });
        };
        for (const p of [...trip.itinerary.days.flatMap((d) => d.stops), ...(trip.itinerary.hotels ?? [])]) {
          const from = p.friend && p.candidateId ? produced.get(p.candidateId) : undefined;
          for (const c of from?.credits ?? []) add(c.userId, "itinerary", trip.id, from!.cityKey);
        }
        const lk = await like;
        if (lk) add(lk.ownerId, "plan_like", lk.id, lk.cityKey);
        if (rows.size) {
          const { error } = await supabaseAdmin().from("pick_credits").upsert([...rows.values()], { onConflict: "owner_id,beneficiary_id,kind,ref", ignoreDuplicates: true });
          logFail("credits", error);
        }
      } catch (e) {
        console.error("friends' credit failed", e);
      }
      return trip;
    },
  };
}

const NO_FRIENDS: FriendSource = { candidates: async () => [], credit: async (t) => t };
/**
 * The friends source for edits to an existing trip: its owner's friends, and their answers. Only
 * when the owner is editing: people planning with them aren't those friends' friends.
 */
export const friendsForTrip = (row: { user_id: string }, ctx: { user: { id: string } | null }) =>
  ctx.user?.id === row.user_id ? friendSource(row.user_id) : NO_FRIENDS;

// ---------------------------------------------------------------------------
// Profiles: local expert cities, credits, the setting
// ---------------------------------------------------------------------------

/** Someone's local expert cities, from their home city and the past trips this viewer may count. */
async function localCitiesOf(userId: string, homeCity: string | null, viewerId: string | null): Promise<{ key: string; label: string }[]> {
  const levels = viewerId === userId || (viewerId && (await follows(viewerId, userId))) ? ["followers", "public"] : ["public"];
  const { data, error } = await supabaseAdmin().from("past_trips").select("city, year, month").eq("user_id", userId).in("visibility", levels).limit(1000);
  if (error) {
    logFail("local cities", error);
    return localExpertCities({ homeCity, trips: [] });
  }
  return localExpertCities({ homeCity, trips: (data ?? []) as { city: string; year: number | null; month: number | null }[] });
}

/** "Local expert: Lisbon" on a profile. */
export async function localCitiesFor(ctx: Ctx, handle: string): Promise<{ key: string; label: string }[] | null> {
  const { data, error } = await supabaseAdmin().from("community_profiles").select("user_id, home_city").eq("handle", handle.toLowerCase()).maybeSingle();
  logFail("profile", error);
  if (!data) return null;
  return localCitiesOf(data.user_id as string, (data.home_city as string) ?? null, ctx.user?.id ?? null);
}

/** Your own: the setting, the cities you're a local for, and how your picks have helped friends. */
export async function friendsMe(ctx: Ctx): Promise<FriendsMe & { off?: boolean }> {
  const empty = { picksForFriends: true, localCities: [], credits: { friends: 0, cities: [] } };
  if (isGuest(ctx)) return empty;
  const me = ctx.user!.id;
  const db = supabaseAdmin();
  const [{ data: p, error }, { data: credits, error: cErr }] = await Promise.all([
    db.from("community_profiles").select("home_city, picks_for_friends").eq("user_id", me).maybeSingle(),
    db.from("pick_credits").select("beneficiary_id, city_key").eq("owner_id", me).limit(5000),
  ]);
  if (isMissing(error) || isMissing(cErr)) return { ...empty, off: true };
  logFail("my profile", error ?? cErr);
  return {
    picksForFriends: p?.picks_for_friends !== false,
    localCities: p ? await localCitiesOf(me, (p.home_city as string) ?? null, me) : [],
    credits: creditSummary((credits ?? []).map((r) => ({ beneficiaryId: r.beneficiary_id as string, cityKey: (r.city_key as string) ?? "" }))),
  };
}

export async function setPicksForFriends(ctx: Ctx, on: boolean): Promise<boolean> {
  if (isGuest(ctx)) throw new HttpError(401, "Sign in with your email to join the community.", "needs_email");
  // The caller's own row (row-level security).
  const { data, error } = await ctx.db.from("community_profiles").update({ picks_for_friends: on }).eq("user_id", ctx.user!.id).select("picks_for_friends").maybeSingle();
  if (isMissing(error)) throw new HttpError(503, FRIENDS_OFF, "friends_off");
  if (error) {
    logFail("setting", error);
    throw new HttpError(500, "We couldn't save that. Try again.");
  }
  if (!data) throw new HttpError(400, "Create your community profile first.", "needs_profile");
  return data.picks_for_friends !== false;
}
