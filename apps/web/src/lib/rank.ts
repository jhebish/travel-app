import {
  NUDGE_DAYS,
  RANK_GROUP_LABELS,
  RANK_KIND_NOUNS,
  addDays,
  countryName,
  daysBetween,
  nextPair,
  rankByGroup,
  rankOpensAt,
  rankOrder,
  rankScores,
  signalRankGroup,
  stopRankKind,
  tasteRanking,
  tripLength,
  tripOverOn,
  type Itinerary,
  type PlacePhoto,
  type RankCard,
  type RankedGroup,
  type RankedPlace,
  type RankGroup,
  type RankItem,
  type RankNudge,
  type RankNudges,
  type RankState,
  type RankVote,
  type SignalKind,
  type TasteRanking,
  type TripRankState,
} from "@travel/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "./auth";
import { HttpError, isUuid } from "./http";
import { namesMatch } from "./places";
import { supabaseAdmin } from "./supabase/server";
import { memberIds } from "./together";
import { tripFor } from "./tripAccess";
import type { TripRow } from "./trips";

/**
 * "Which did you love more?" on the server.
 *  * Your own past trips and places (rank_votes): read and written with the caller's client, so
 *    row-level security keeps every row the caller's own (it also checks both items are theirs).
 *    After each answer the scores are worked out again and stored in rank_score.
 *  * A Pylos trip's stops and hotels, after the trip (trip_rank_votes): written by the server
 *    after checking the caller is the trip's owner or a friend planning it, pinned to the places'
 *    names like reactions are, and shown back only as everyone's answers together.
 */

type DbError = { code?: string; message?: string } | null;
const MISSING = ["42P01", "42703", "PGRST205", "PGRST204", "42883"];

/** Tables or columns missing = the community loop migration hasn't been run yet. */
function check(error: DbError, what: string): void {
  if (!error) return;
  if (MISSING.includes(error.code ?? "")) {
    throw new HttpError(503, "Ranking isn't set up yet. Run the community loop database migration in Supabase.", "rank_off");
  }
  console.error(`rank: ${what} failed`, error.code ?? "", (error.message ?? "").slice(0, 120));
  throw new HttpError(500, "Something went wrong with your ranking. Try again.");
}

// ---------------------------------------------------------------------------
// rank_score before the migration: readers fall back to the old columns for a while
// ---------------------------------------------------------------------------
let rankColsMissingUntil = 0;
/** Is the rank_score column there, as far as we know? */
export const rankColumns = () => Date.now() >= rankColsMissingUntil;
/** A select with rank_score failed: it isn't there yet. Ask again in ten minutes. */
export function rankColumnsFailed(error: DbError): boolean {
  if (!error || !["42703", "PGRST204"].includes(error.code ?? "")) return false;
  rankColsMissingUntil = Date.now() + 10 * 60_000;
  return true;
}

/** More answers in an hour than anyone tapping by hand would give. */
const VOTES_PER_HOUR = 600;
async function voteBudget(db: SupabaseClient, table: "rank_votes" | "trip_rank_votes", userId: string) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  check(error, "vote count");
  if ((count ?? 0) >= VOTES_PER_HOUR) throw new HttpError(429, "That's a lot of choosing for one hour. Take a break and come back to it later.", "rate_limited");
}

const SKIP_KEY = /^[A-Za-z0-9-]{3,40}~[A-Za-z0-9-]{3,40}$/;
/** Pair keys the client says were skipped this session ("Can't decide"). */
export const cleanSkips = (list: readonly string[]) => [...new Set(list.filter((k) => SKIP_KEY.test(k)))].slice(0, 60);

const groupLabel = (g: string) => RANK_GROUP_LABELS[g as RankGroup] ?? "Others";
const cityOf = (destination: string) => destination.split(",")[0]!.trim();

// ---------------------------------------------------------------------------
// Your own past trips and places
// ---------------------------------------------------------------------------
export type OwnKind = "trip" | "place";

interface OwnItem extends RankItem {
  name: string;
  where: string | null;
  kind: string;
  pastTripId: string | null;
  /** The Pylos trip it came from, for a photo. */
  tripId: string | null;
  rankScore: number | null;
}

interface PastRow {
  id: string;
  city: string;
  country_code: string;
  year: number | null;
  month: number | null;
  days: number | null;
  trip_id: string | null;
  rank_score: number | null;
}
interface SignalRow {
  id: string;
  past_trip_id: string | null;
  kind: SignalKind;
  name: string;
  city: string | null;
  rating: number | null;
  liked: boolean | null;
  rank_score: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tripKind = (p: PastRow) =>
  [p.month && p.year ? `${MONTHS[p.month - 1]} ${p.year}` : p.year ? String(p.year) : "", p.days ? `${p.days} ${p.days === 1 ? "day" : "days"}` : ""].filter(Boolean).join(" · ") || "Trip";

async function loadOwn(ctx: Ctx & { user: { id: string } }, kind: OwnKind, pastTripId: string | null) {
  const me = ctx.user.id;
  let trip: { id: string; city: string } | null = null;
  if (pastTripId) {
    if (!isUuid(pastTripId)) throw new HttpError(404, "That trip isn't in your places.");
    const { data, error } = await ctx.db.from("past_trips").select("id, city").eq("id", pastTripId).eq("user_id", me).maybeSingle();
    check(error, "past trip");
    if (!data) throw new HttpError(404, "That trip isn't in your places.");
    trip = { id: data.id as string, city: data.city as string };
  }
  const votesQ = ctx.db.from("rank_votes").select("winner_id, loser_id").eq("user_id", me).eq("item_kind", kind).order("id", { ascending: false }).limit(5000);
  let all: OwnItem[];
  if (kind === "trip") {
    const [{ data, error }, votes] = await Promise.all([
      ctx.db.from("past_trips").select("id, city, country_code, year, month, days, trip_id, rank_score").eq("user_id", me).limit(1000),
      votesQ,
    ]);
    check(error ?? votes.error, "past trips");
    all = ((data ?? []) as PastRow[]).map((p) => ({
      id: p.id,
      group: "trip",
      name: p.city,
      where: countryName(p.country_code),
      kind: tripKind(p),
      pastTripId: p.id,
      tripId: p.trip_id,
      rankScore: p.rank_score,
    }));
    return { all, scope: all, votes: toVotes(votes.data), trip: null };
  }
  const [{ data, error }, votes] = await Promise.all([
    ctx.db.from("taste_signals").select("id, past_trip_id, kind, name, city, rating, liked, rank_score").eq("user_id", me).order("created_at", { ascending: false }).limit(2000),
    votesQ,
  ]);
  check(error ?? votes.error, "places");
  all = ((data ?? []) as SignalRow[])
    // Places they didn't like aren't a "which did you love more?" question.
    .filter((s) => signalRankGroup(s.kind) && s.liked !== false && !(s.rating != null && s.rating <= 2))
    .map((s) => ({
      id: s.id,
      group: signalRankGroup(s.kind)!,
      name: s.name,
      where: s.city,
      kind: RANK_KIND_NOUNS[s.kind] ?? "Place",
      pastTripId: s.past_trip_id,
      tripId: null,
      rankScore: s.rank_score,
    }));
  const scope = trip ? all.filter((s) => s.pastTripId === trip!.id) : all;
  return { all, scope, votes: toVotes(votes.data), trip };
}

const toVotes = (rows: { winner_id: string; loser_id: string }[] | null): RankVote[] => (rows ?? []).map((r) => ({ winner: r.winner_id, loser: r.loser_id }));

/** Photos for the two cards, from the Pylos trips the places or trips came from (no new lookups). */
async function ownPhotos(ctx: Ctx, items: OwnItem[]): Promise<Map<string, PlacePhoto>> {
  const out = new Map<string, PlacePhoto>();
  const pastIds = items.filter((i) => !i.tripId && i.pastTripId).map((i) => i.pastTripId!);
  const tripOfPast = new Map<string, string>();
  if (pastIds.length) {
    const { data } = await ctx.db.from("past_trips").select("id, trip_id").in("id", pastIds);
    for (const r of data ?? []) if (r.trip_id) tripOfPast.set(r.id as string, r.trip_id as string);
  }
  const tripIds = [...new Set(items.map((i) => i.tripId ?? (i.pastTripId ? tripOfPast.get(i.pastTripId) : undefined)).filter((x): x is string => !!x))];
  if (!tripIds.length) return out;
  const { data } = await ctx.db.from("trips").select("id, itinerary").in("id", tripIds);
  const its = new Map((data ?? []).map((r) => [r.id as string, r.itinerary as Itinerary]));
  for (const i of items) {
    const it = its.get(i.tripId ?? tripOfPast.get(i.pastTripId ?? "") ?? "");
    if (!it) continue;
    const places = [...(it.hotels ?? []), ...it.days.flatMap((d) => d.stops)];
    const photo =
      i.group === "trip"
        ? places.find((p) => p.place?.photos?.length)?.place?.photos?.[0]
        : places.find((p) => p.place?.photos?.length && namesMatch(p.name, i.name))?.place?.photos?.[0];
    if (photo) out.set(i.id, photo);
  }
  return out;
}

const card = (i: OwnItem, photo?: PlacePhoto): RankCard => ({ id: i.id, name: i.name, where: i.where, kind: i.kind, group: i.group, photo: photo ?? null });

function rankedGroups(items: OwnItem[], votes: RankVote[], perGroup = 10): RankedGroup[] {
  return rankByGroup(items, votes).map((g) => ({
    group: g.group,
    label: groupLabel(g.group),
    items: g.items.slice(0, perGroup).map((x) => ({ id: x.id, name: x.name, where: x.where, kind: x.kind, score: x.score, comparisons: x.comparisons })),
  }));
}

async function ownState(ctx: Ctx, kind: OwnKind, loaded: Awaited<ReturnType<typeof loadOwn>>, skip: string[]): Promise<RankState> {
  const { scope, votes, trip } = loaded;
  const ids = nextPair(scope, votes, { skip });
  const byId = new Map(scope.map((i) => [i.id, i]));
  let pair: RankState["pair"] = null;
  if (ids) {
    const two = ids.map((id) => byId.get(id)!);
    const photos = await ownPhotos(ctx, two).catch(() => new Map<string, PlacePhoto>());
    pair = [card(two[0]!, photos.get(two[0]!.id)), card(two[1]!, photos.get(two[1]!.id))];
  }
  return { kind, trip, pair, ranked: rankedGroups(scope, votes), votes: votes.length, items: scope.length };
}

/** The next pair and your ranking so far. */
export async function getOwnRank(ctx: Ctx & { user: { id: string } }, kind: OwnKind, pastTripId: string | null, skip: string[]): Promise<RankState> {
  return ownState(ctx, kind, await loadOwn(ctx, kind, pastTripId), skip);
}

/** Record "I loved this one more", store everyone's new scores, and send the next pair. */
export async function voteOwn(
  ctx: Ctx & { user: { id: string } },
  kind: OwnKind,
  pastTripId: string | null,
  winner: string,
  loser: string,
  skip: string[],
): Promise<RankState> {
  if (!isUuid(winner) || !isUuid(loser) || winner === loser) throw new HttpError(400, "Pick one of the two.");
  const loaded = await loadOwn(ctx, kind, pastTripId);
  const w = loaded.all.find((i) => i.id === winner);
  const l = loaded.all.find((i) => i.id === loser);
  if (!w || !l) throw new HttpError(404, "One of those isn't in your list anymore. Here's another pair.", "gone");
  if (w.group !== l.group) throw new HttpError(400, "Those two aren't the same kind of place.");
  await voteBudget(ctx.db, "rank_votes", ctx.user.id);
  const { error } = await ctx.db.from("rank_votes").insert({ user_id: ctx.user.id, item_kind: kind, winner_id: winner, loser_id: loser });
  if (error?.code === "42501") throw new HttpError(404, "One of those isn't in your list anymore.", "gone");
  check(error, "vote");
  loaded.votes.unshift({ winner, loser });
  await storeScores(ctx, kind, loaded.all, loaded.votes);
  return ownState(ctx, kind, loaded, skip);
}

/** Work the scores out again from every answer of this kind and save the ones that moved. */
async function storeScores(ctx: Ctx & { user: { id: string } }, kind: OwnKind, items: OwnItem[], votes: RankVote[]) {
  const scores = rankScores(
    items.map((i) => i.id),
    votes,
  );
  const changed = items.filter((i) => {
    const s = scores.get(i.id) ?? null;
    return s == null ? i.rankScore != null : i.rankScore == null || Math.abs(s - i.rankScore) >= 0.01;
  });
  const table = kind === "trip" ? "past_trips" : "taste_signals";
  for (let k = 0; k < changed.length; k += 10) {
    const results = await Promise.all(
      changed.slice(k, k + 10).map((i) =>
        ctx.db
          .from(table)
          .update({ rank_score: scores.get(i.id) ?? null })
          .eq("id", i.id)
          .eq("user_id", ctx.user.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      // The answer is saved; the scores catch up on the next one.
      console.error("rank: score update failed", failed.error.code ?? "");
      return;
    }
    for (const i of changed.slice(k, k + 10)) i.rankScore = scores.get(i.id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// A Pylos trip's stops and hotels, after the trip
// ---------------------------------------------------------------------------
interface TripItem extends RankItem {
  name: string;
  kind: string;
  where: string | null;
  photo: PlacePhoto | null;
}

/** Every stop and hotel once (a place on two days counts once), keyed like reactions ("0-2", "h-1"). */
function tripItems(row: Pick<TripRow, "itinerary" | "destination">): TripItem[] {
  const it = row.itinerary;
  const seen = new Set<string>();
  const out: TripItem[] = [];
  const city = cityOf(row.destination);
  (it.hotels ?? []).forEach((h, i) => {
    const k = h.name.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ id: `h-${i}`, group: "stay", name: h.name.slice(0, 160), kind: "Stay", where: h.city || city, photo: h.place?.photos?.[0] ?? null });
  });
  it.days.forEach((d, di) =>
    d.stops.forEach((s, si) => {
      const k = s.name.trim().toLowerCase();
      if (!k || seen.has(k) || di > 99 || si > 99) return;
      seen.add(k);
      const { group, noun } = stopRankKind(s);
      out.push({ id: `${di}-${si}`, group, name: s.name.slice(0, 160), kind: noun, where: d.city || city, photo: s.place?.photos?.[0] ?? null });
    }),
  );
  return out;
}

interface TripVoteRow {
  user_id: string;
  winner_item: string;
  winner_name: string;
  loser_item: string;
  loser_name: string;
}

async function tripContext(ctx: Ctx & { user: { id: string } }, tripId: string) {
  const { row } = await tripFor(ctx, tripId);
  const members = await memberIds(row.id);
  const people = [row.user_id, ...members];
  const items = tripItems(row);
  const names = new Map(items.map((i) => [i.id, i.name]));
  const { data, error } = await supabaseAdmin()
    .from("trip_rank_votes")
    .select("user_id, winner_item, winner_name, loser_item, loser_name")
    .eq("trip_id", row.id)
    .order("id", { ascending: false })
    .limit(5000);
  check(error, "trip votes");
  // Only people still on the trip, and only for the place still in that slot.
  const votes = ((data ?? []) as TripVoteRow[]).filter(
    (v) => people.includes(v.user_id) && names.get(v.winner_item) === v.winner_name && names.get(v.loser_item) === v.loser_name,
  );
  const overOn = tripOverOn(row.request?.startDate, tripLength(row));
  const open = !!overOn && Date.now() >= rankOpensAt(overOn);
  return { row, members, people, items, votes, overOn, open };
}

function tripState(me: string, c: Awaited<ReturnType<typeof tripContext>>, skip: string[]): TripRankState {
  const { row, members, people, items, votes, overOn, open } = c;
  const mine = votes.filter((v) => v.user_id === me).map((v) => ({ winner: v.winner_item, loser: v.loser_item }));
  const voters = new Set(votes.map((v) => v.user_id));
  const ids = open ? nextPair(items, mine, { skip }) : null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const toCard = (i: TripItem): RankCard => ({ id: i.id, name: i.name, where: i.where, kind: i.kind, group: i.group, photo: i.photo });
  // Everyone's answers together, once two people have ranked. Until then a lone ranking is shown
  // only to the person who gave it, so nobody's answers are on show on their own.
  const mineOnly = voters.size === 1 && voters.has(me);
  const shown = voters.size >= 2 || mineOnly ? votes : [];
  const favourites = rankByGroup(
    items,
    shown.map((v) => ({ winner: v.winner_item, loser: v.loser_item })),
  ).map((g) => ({
    group: g.group,
    label: groupLabel(g.group),
    items: g.items.slice(0, 5).map((x) => ({ id: x.id, name: x.name, where: x.where, kind: x.kind, score: x.score, comparisons: x.comparisons })),
  }));
  return {
    tripId: row.id,
    city: cityOf(row.destination),
    title: row.title,
    open,
    overOn,
    together: members.length > 0,
    people: people.length,
    voters: voters.size,
    mine: mine.length,
    pair: ids ? [toCard(byId.get(ids[0])!), toCard(byId.get(ids[1])!)] : null,
    favourites,
    mineOnly,
  };
}

export async function getTripRank(ctx: Ctx & { user: { id: string } }, tripId: string, skip: string[]): Promise<TripRankState> {
  return tripState(ctx.user.id, await tripContext(ctx, tripId), skip);
}

export async function voteTrip(ctx: Ctx & { user: { id: string } }, tripId: string, winner: string, loser: string, skip: string[]): Promise<TripRankState> {
  if (winner === loser) throw new HttpError(400, "Pick one of the two.");
  const c = await tripContext(ctx, tripId);
  if (!c.open) throw new HttpError(409, "This trip isn't over yet. Rank it the morning after.", "not_over");
  const w = c.items.find((i) => i.id === winner);
  const l = c.items.find((i) => i.id === loser);
  if (!w || !l) throw new HttpError(404, "That stop isn't in this trip anymore. Reload and try again.", "gone");
  const db = supabaseAdmin();
  await voteBudget(db, "trip_rank_votes", ctx.user.id);
  const row = { trip_id: c.row.id, user_id: ctx.user.id, winner_item: w.id, winner_name: w.name, loser_item: l.id, loser_name: l.name };
  const { error } = await db.from("trip_rank_votes").insert(row);
  check(error, "trip vote");
  c.votes.unshift(row);
  return tripState(ctx.user.id, c, skip);
}

// ---------------------------------------------------------------------------
// "Back from Lisbon?" nudges, and the trips the phone reminds about
// ---------------------------------------------------------------------------
interface DatedTrip {
  id: string;
  destination: string;
  start: string | null;
  days: number | null;
}

export async function rankNudges(ctx: Ctx & { user: { id: string } }): Promise<RankNudges> {
  const me = ctx.user.id;
  const admin = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const oldest = addDays(today, -(NUDGE_DAYS + 1));

  // Pylos trips with dates: mine, and ones friends are planning with me.
  const [own, member] = await Promise.all([
    ctx.db.from("trips").select("id, destination, start:request->>startDate, days:request->days").eq("user_id", me).not("request->>startDate", "is", null).order("created_at", { ascending: false }).limit(200),
    admin.from("trip_members").select("trip_id").eq("user_id", me).limit(100),
  ]);
  let dated = ((own.data ?? []) as DatedTrip[]).slice();
  const memberTripIds = (member.data ?? []).map((r) => r.trip_id as string);
  if (memberTripIds.length) {
    const { data } = await admin.from("trips").select("id, destination, start:request->>startDate, days:request->days").in("id", memberTripIds);
    dated = dated.concat(((data ?? []) as DatedTrip[]).filter((t) => t.start));
  }
  const withDates = dated
    .map((t) => ({ ...t, overOn: tripOverOn(t.start, t.days || 1) }))
    .filter((t): t is DatedTrip & { overOn: string } => !!t.overOn);

  const upcoming: RankNudge[] = withDates
    .filter((t) => t.overOn >= today)
    .sort((a, b) => a.overOn.localeCompare(b.overOn))
    .slice(0, 20)
    .map((t) => ({ key: `plan:${t.id}`, city: cityOf(t.destination), overOn: t.overOn, href: `/rank?plan=${t.id}` }));

  const justOver = withDates.filter((t) => t.overOn >= oldest && Date.now() >= rankOpensAt(t.overOn));
  const recent: RankNudge[] = [];
  // Which of those I've ranked (and, with nothing just over, whether ranking is set up at all:
  // before the migration there's nothing to nudge or remind about).
  const votesQ = admin.from("trip_rank_votes").select("trip_id").eq("user_id", me);
  const { data: rankedRows, error: rankErr } = justOver.length
    ? await votesQ.in(
        "trip_id",
        justOver.map((t) => t.id),
      )
    : await votesQ.limit(1);
  if (rankErr) return { recent: [], upcoming: [] };
  const ranked = new Set((rankedRows ?? []).map((r) => r.trip_id as string));
  for (const t of justOver) if (!ranked.has(t.id)) recent.push({ key: `plan:${t.id}`, city: cityOf(t.destination), overOn: t.overOn, href: `/rank?plan=${t.id}` });

  // Past trips just logged or just over (from the dates of their places), not yet ranked.
  const { data: past } = await ctx.db.from("past_trips").select("id, city, year, month, trip_id, created_at").eq("user_id", me).gte("created_at", addDays(today, -40)).limit(100);
  const datedIds = new Set(withDates.map((t) => t.id));
  const candidates = (past ?? []).filter((p) => !(p.trip_id && datedIds.has(p.trip_id as string)));
  if (candidates.length) {
    const { data: sigs, error } = await ctx.db
      .from("taste_signals")
      .select("past_trip_id, kind, visited_on, liked, rating, rank_score")
      .in(
        "past_trip_id",
        candidates.map((p) => p.id as string),
      )
      .limit(2000);
    if (!error) {
      const [y, m] = today.split("-").map(Number) as [number, number];
      // Without dates on its places, a trip logged this week for this month or last counts as just over.
      const monthsAgo = (py: number | null, pm: number | null) => (py && pm ? (y - py) * 12 + (m - pm) : 99);
      for (const p of candidates) {
        const mine = (sigs ?? []).filter((s) => s.past_trip_id === p.id && s.liked !== false && !(s.rating != null && s.rating <= 2));
        if (mine.some((s) => s.rank_score != null)) continue; // ranked already
        const groups = new Map<string, number>();
        for (const s of mine) {
          const g = signalRankGroup(s.kind as SignalKind);
          if (g) groups.set(g, (groups.get(g) ?? 0) + 1);
        }
        if (![...groups.values()].some((n) => n >= 2)) continue; // nothing to compare
        const lastDay = mine.map((s) => s.visited_on as string | null).filter((d): d is string => !!d).sort().at(-1);
        const loggedOn = String(p.created_at).slice(0, 10);
        const overOn = lastDay ? addDays(lastDay, 1) : monthsAgo(p.year as number | null, p.month as number | null) <= 1 ? loggedOn : null;
        if (!overOn || overOn < oldest || overOn > today) continue;
        recent.push({ key: `past:${p.id}`, city: p.city as string, overOn, href: `/rank?trip=${p.id}` });
      }
    }
  }
  recent.sort((a, b) => b.overOn.localeCompare(a.overOn));
  return { recent: recent.slice(0, 5), upcoming };
}

// ---------------------------------------------------------------------------
// For the taste profile
// ---------------------------------------------------------------------------

/**
 * The top of someone's own ranking for the taste prompt (trips and places from taste_signals come
 * from `pastTrips`/`signals` the caller already loaded), plus the stops they ranked on their
 * latest Pylos trips. `stamp` moves with every new answer, so a cached profile goes out of date.
 */
export async function rankingForTaste(
  db: SupabaseClient,
  userId: string,
  pastTrips: { city: string; country: string; year?: number | null; rankScore?: number | null }[],
  signals: { name: string; city?: string | null; kind: SignalKind; rankScore?: number | null }[],
): Promise<{ ranking: TasteRanking; stamp: string }> {
  const places: RankedPlace[] = signals
    .filter((s) => typeof s.rankScore === "number" && signalRankGroup(s.kind))
    .map((s) => ({ name: s.name, city: s.city ?? null, group: signalRankGroup(s.kind)!, rankScore: s.rankScore! }));
  let stamp = "";
  try {
    const [own, onTrips] = await Promise.all([
      db.from("rank_votes").select("id", { count: "exact", head: true }).eq("user_id", userId),
      db.from("trip_rank_votes").select("trip_id, winner_item, winner_name, loser_item, loser_name, created_at").eq("user_id", userId).order("id", { ascending: false }).limit(1000),
    ]);
    if (!own.error && !onTrips.error) {
      const rows = (onTrips.data ?? []) as (Omit<TripVoteRow, "user_id"> & { trip_id: string; created_at: string })[];
      stamp = `${own.count ?? 0}:${rows.length}:${rows[0]?.created_at ?? ""}`;
      const tripIds = [...new Set(rows.map((r) => r.trip_id))].slice(0, 6);
      if (tripIds.length) {
        const { data } = await supabaseAdmin().from("trips").select("id, destination, itinerary").in("id", tripIds);
        for (const t of (data ?? []) as Pick<TripRow, "id" | "destination" | "itinerary">[]) {
          const items = tripItems(t);
          const names = new Map(items.map((i) => [i.id, i.name]));
          const votes = rows
            .filter((r) => r.trip_id === t.id && names.get(r.winner_item) === r.winner_name && names.get(r.loser_item) === r.loser_name)
            .map((r) => ({ winner: r.winner_item, loser: r.loser_item }));
          const byId = new Map(items.map((i) => [i.id, i]));
          for (const e of rankOrder(
            items.map((i) => i.id),
            votes,
          )) {
            const i = byId.get(e.id)!;
            places.push({ name: i.name, city: i.where, group: i.group, rankScore: e.score });
          }
        }
      }
    }
  } catch (e) {
    console.error("rank: taste ranking failed", e);
  }
  return { ranking: tasteRanking(pastTrips, places), stamp };
}

