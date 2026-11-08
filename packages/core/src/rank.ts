import { matchKind } from "./imports/kind";
import type { SignalKind } from "./labels";
import type { StopKind } from "./quality";
import type { PlacePhoto } from "./schemas";

/**
 * "Which did you love more?": two of someone's places (or trips) side by side, tap the one they
 * loved more. The answers become a ranking (Bradley-Terry, so the same answers in any order give
 * the same ranking), and the next pair is the one that teaches the most: places that haven't been
 * compared much and sit close together in the ranking. Places are only compared with their own
 * kind (stays with stays, restaurants with restaurants), so every question is a fair one.
 */

export interface RankVote {
  winner: string;
  loser: string;
}

export interface RankItem {
  id: string;
  /** Items are only paired within a group (see RANK_GROUPS). */
  group: string;
}

/** A pair's key, the same whichever way round it was shown. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);

// ---------------------------------------------------------------------------
// Groups: what's compared with what
// ---------------------------------------------------------------------------

export const RANK_GROUPS = ["stay", "food", "coffee", "drink", "see", "shop", "trip"] as const;
export type RankGroup = (typeof RANK_GROUPS)[number];

/** Headings for ranked lists, in the order they're shown. */
export const RANK_GROUP_LABELS: Record<RankGroup, string> = {
  stay: "Stays",
  food: "Restaurants",
  coffee: "Cafés",
  drink: "Bars and nights out",
  see: "Sights and things to do",
  shop: "Shops",
  trip: "Trips",
};

/** What a single place is, on its card. */
export const RANK_KIND_NOUNS: Record<SignalKind, string> = {
  stay: "Stay",
  food: "Restaurant",
  coffee: "Café",
  drink: "Bar",
  nightlife: "Night out",
  sight: "Sight",
  activity: "Something to do",
  shop: "Shop",
  city: "City",
};

const SIGNAL_GROUP: Record<SignalKind, RankGroup | null> = {
  stay: "stay",
  food: "food",
  coffee: "coffee",
  drink: "drink",
  nightlife: "drink",
  sight: "see",
  activity: "see",
  shop: "shop",
  city: null, // a whole city isn't a place to compare with a restaurant
};
/** The group a taste signal is ranked in; null for kinds that aren't ranked (cities). */
export const signalRankGroup = (kind: SignalKind): RankGroup | null => SIGNAL_GROUP[kind] ?? null;

const STOP_GROUP: Record<StopKind, RankGroup> = {
  coffee: "coffee",
  meal: "food",
  drinks: "drink",
  nightlife: "drink",
  sight: "see",
  activity: "see",
  nature: "see",
  market: "see",
  shop: "shop",
};
const STOP_NOUN: Record<StopKind, string> = {
  coffee: "Café",
  meal: "Restaurant",
  drinks: "Bar",
  nightlife: "Night out",
  sight: "Sight",
  activity: "Something to do",
  nature: "Outdoors",
  market: "Market",
  shop: "Shop",
};

/** A stop on a Pylos plan: its group and card label, from its kind or, for older plans, its name. */
export function stopRankKind(stop: { kind?: StopKind | null; name: string }): { group: RankGroup; noun: string } {
  if (stop.kind && STOP_GROUP[stop.kind]) return { group: STOP_GROUP[stop.kind], noun: STOP_NOUN[stop.kind] };
  const k = matchKind(stop.name);
  const group = (k && signalRankGroup(k)) || "see";
  return { group, noun: k && k !== "city" ? RANK_KIND_NOUNS[k] : "Stop" };
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * How much the ranking trusts a handful of answers: every item plays this many virtual games, half
 * won and half lost, against an average item. It keeps a place that won its only comparison from
 * leaping above one that won ten, and keeps every score finite.
 */
const PRIOR_GAMES = 2;

/** Only votes between two of these items, never an item against itself. */
function usable(ids: ReadonlySet<string>, votes: readonly RankVote[]): RankVote[] {
  return votes.filter((v) => v.winner !== v.loser && ids.has(v.winner) && ids.has(v.loser));
}

/**
 * Bradley-Terry strengths (natural log scale, 0 = average) for items with at least one vote.
 * Fitted with the MM algorithm (Hunter 2004) plus the prior above, so it converges for any set of
 * answers, including one-sided ones. Depends only on how often each item beat each other one, so
 * the order of the votes never matters.
 */
export function rankStrengths(ids: readonly string[], votes: readonly RankVote[]): Map<string, number> {
  const set = new Set(ids);
  const vs = usable(set, votes);
  const wins = new Map<string, number>();
  const games = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string) => {
    const m = games.get(a) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    games.set(a, m);
  };
  for (const v of vs) {
    wins.set(v.winner, (wins.get(v.winner) ?? 0) + 1);
    bump(v.winner, v.loser);
    bump(v.loser, v.winner);
  }
  const played = [...games.keys()].sort();
  if (!played.length) return new Map();
  // Opponents in a fixed order, so the sums (and so the scores) don't depend on the votes' order.
  const opponents = new Map(played.map((id) => [id, [...games.get(id)!.entries()].sort(([a], [b]) => (a < b ? -1 : 1))]));
  let p = new Map(played.map((id) => [id, 1]));
  for (let iter = 0; iter < 500; iter++) {
    const next = new Map<string, number>();
    let delta = 0;
    for (const i of played) {
      const pi = p.get(i)!;
      // Virtual games against the anchor (strength 1): PRIOR_GAMES / 2 won, as many lost.
      let denom = PRIOR_GAMES / (pi + 1);
      for (const [j, n] of opponents.get(i)!) denom += n / (pi + p.get(j)!);
      const v = ((wins.get(i) ?? 0) + PRIOR_GAMES / 2) / denom;
      next.set(i, v);
      delta = Math.max(delta, Math.abs(Math.log(v) - Math.log(pi)));
    }
    p = next;
    if (delta < 1e-10) break;
  }
  return new Map(played.map((id) => [id, Math.log(p.get(id)!)]));
}

/**
 * Scores to store (`rank_score`): 50 is an average item, higher is loved more, roughly 20–80 in
 * practice. Only items that have been compared get one.
 */
export function rankScores(ids: readonly string[], votes: readonly RankVote[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, s] of rankStrengths(ids, votes)) out.set(id, Math.round(Math.min(100, Math.max(0, 50 + 10 * s)) * 100) / 100);
  return out;
}

/** How many times each item has been compared. */
export function comparisonCounts(ids: readonly string[], votes: readonly RankVote[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of usable(new Set(ids), votes)) {
    out.set(v.winner, (out.get(v.winner) ?? 0) + 1);
    out.set(v.loser, (out.get(v.loser) ?? 0) + 1);
  }
  return out;
}

export interface RankedEntry {
  id: string;
  score: number;
  comparisons: number;
  wins: number;
}

/** Compared items, loved most first. */
export function rankOrder(ids: readonly string[], votes: readonly RankVote[]): RankedEntry[] {
  const scores = rankScores(ids, votes);
  const counts = comparisonCounts(ids, votes);
  const wins = new Map<string, number>();
  for (const v of usable(new Set(ids), votes)) wins.set(v.winner, (wins.get(v.winner) ?? 0) + 1);
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, comparisons: counts.get(id) ?? 0, wins: wins.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score || b.comparisons - a.comparisons || a.id.localeCompare(b.id));
}

/** Ranked within each group, groups in RANK_GROUPS order (unknown groups last). */
export function rankByGroup<T extends RankItem>(items: readonly T[], votes: readonly RankVote[]): { group: string; items: (T & RankedEntry)[] }[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = rankOrder(items.map((i) => i.id), votes);
  const groups = new Map<string, (T & RankedEntry)[]>();
  for (const e of order) {
    const item = byId.get(e.id)!;
    const list = groups.get(item.group) ?? [];
    list.push({ ...item, ...e });
    groups.set(item.group, list);
  }
  const pos = (g: string) => {
    const i = (RANK_GROUPS as readonly string[]).indexOf(g);
    return i < 0 ? RANK_GROUPS.length : i;
  };
  return [...groups.entries()].sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b)).map(([group, list]) => ({ group, items: list }));
}

// ---------------------------------------------------------------------------
// The next pair
// ---------------------------------------------------------------------------

/** FNV-1a: a stable tie-break, so the same answers always lead to the same next question. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The least-compared items of a group that are considered for the next pair (bounds the work). */
const CANDIDATES_PER_GROUP = 40;

/**
 * The most useful pair to ask about next, or null when there's nothing left to compare. Prefers
 * items that have been compared least, whose scores are close (the answer is least predictable),
 * and pairs not asked before. `skip` holds pairKeys to leave out (ones they couldn't decide on).
 * Deterministic: the same items, answers and skips give the same pair, shown the same way round.
 */
export function nextPair(items: readonly RankItem[], votes: readonly RankVote[], opts: { skip?: Iterable<string> } = {}): [string, string] | null {
  const skip = new Set(opts.skip ?? []);
  const ids = items.map((i) => i.id);
  const vs = usable(new Set(ids), votes);
  const strength = rankStrengths(ids, vs);
  const counts = comparisonCounts(ids, vs);
  const asked = new Map<string, number>();
  for (const v of vs) asked.set(pairKey(v.winner, v.loser), (asked.get(pairKey(v.winner, v.loser)) ?? 0) + 1);

  const groups = new Map<string, string[]>();
  for (const it of items) {
    if (!it.group) continue;
    const g = groups.get(it.group) ?? [];
    if (!g.includes(it.id)) g.push(it.id);
    groups.set(it.group, g);
  }

  const seed = String(vs.length);
  let best: { a: string; b: string; u: number; h: number } | null = null;
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    const pool = [...members].sort((x, y) => (counts.get(x) ?? 0) - (counts.get(y) ?? 0) || hash(x + seed) - hash(y + seed)).slice(0, CANDIDATES_PER_GROUP);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i]!;
        const b = pool[j]!;
        const key = pairKey(a, b);
        if (skip.has(key)) continue;
        const na = counts.get(a) ?? 0;
        const nb = counts.get(b) ?? 0;
        const closeness = Math.exp(-Math.abs((strength.get(a) ?? 0) - (strength.get(b) ?? 0)));
        const fresh = 2 / (2 + na + nb);
        const repeat = 1 / (1 + 4 * (asked.get(key) ?? 0));
        const u = Math.sqrt(closeness) * fresh * repeat;
        const h = hash(key + "|" + seed);
        if (!best || u > best.u + 1e-12 || (Math.abs(u - best.u) <= 1e-12 && h < best.h)) best = { a, b, u, h };
      }
    }
  }
  if (!best) return null;
  const [x, y] = best.a < best.b ? [best.a, best.b] : [best.b, best.a];
  return best.h % 2 ? [y, x] : [x, y];
}

// ---------------------------------------------------------------------------
// Trip dates: when a trip is over, and the morning after
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zones involved). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

/**
 * The first day after a trip (the morning after): its start date plus its number of days. A trip
 * starting on the 1st with 3 days runs the 1st to the 3rd, so it's over on the 4th. Null without
 * a valid start date.
 */
export function tripOverOn(startDate: string | null | undefined, days: number | null | undefined): string | null {
  if (!startDate || !ISO_DATE.test(startDate) || Number.isNaN(Date.parse(startDate))) return null;
  const n = Math.max(1, Math.min(60, Math.round(Number(days) || 1)));
  return addDays(startDate, n);
}

/** The trip's length for its dates: what was asked for, else the days in the plan. */
export const tripLength = (t: { request?: { days?: number | null } | null; itinerary?: { days?: unknown[] } | null }) =>
  t.request?.days || t.itinerary?.days?.length || 1;

/** Today on the device, as YYYY-MM-DD in its own time zone. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * When the server lets people rank a trip: the morning after begins first in the earliest time
 * zone (UTC+14), so that's when it opens. People elsewhere can start on the trip's last evening;
 * the apps themselves wait for the morning after on the device.
 */
export function rankOpensAt(overOn: string): number {
  return Date.parse(`${overOn}T00:00:00Z`) - 14 * 3600_000;
}

/** How long after a trip the "Back from Lisbon?" nudge stays up. */
export const NUDGE_DAYS = 7;

/** Should the nudge for a trip over on `overOn` show today (YYYY-MM-DD, the device's date)? */
export const nudgeDue = (overOn: string, today: string) => {
  const d = daysBetween(overOn, today);
  return d >= 0 && d < NUDGE_DAYS;
};

// ---------------------------------------------------------------------------
// What the API sends the apps
// ---------------------------------------------------------------------------

/** One of the two cards. */
export interface RankCard {
  id: string;
  name: string;
  /** Where it is ("Lisbon"), or the country for a trip. */
  where: string | null;
  /** What it is: "Restaurant", "Stay", or for a trip its year and length. */
  kind: string;
  group: string;
  photo?: PlacePhoto | null;
}

export interface RankedRow {
  id: string;
  name: string;
  where: string | null;
  kind: string;
  score: number;
  comparisons: number;
}

export interface RankedGroup {
  group: string;
  label: string;
  items: RankedRow[];
}

/** Your own places or past trips: GET/POST /api/rank. */
export interface RankState {
  kind: "trip" | "place";
  /** When ranking the places of one past trip. */
  trip: { id: string; city: string } | null;
  pair: [RankCard, RankCard] | null;
  ranked: RankedGroup[];
  /** Answers given so far (all of this kind). */
  votes: number;
  /** How many items there are to rank here. */
  items: number;
}

/** A Pylos trip's stops and hotels, after it: GET/POST /api/trips/:id/rank. */
export interface TripRankState {
  tripId: string;
  city: string;
  title: string;
  /** Over (on the server's lenient clock); before that there's nothing to rank. */
  open: boolean;
  overOn: string | null;
  /** Planned with friends: favourites are the group's. */
  together: boolean;
  people: number;
  /** How many people have ranked it. */
  voters: number;
  /** My answers so far. */
  mine: number;
  pair: [RankCard, RankCard] | null;
  /** Everyone's answers together. Empty until two people have ranked, unless the one is you. */
  favourites: RankedGroup[];
  /** True when the favourites are just your own answers so far. */
  mineOnly: boolean;
}

/** "Back from Lisbon?" nudges, and the trips to remind about (GET /api/rank/nudges). */
export interface RankNudge {
  key: string;
  city: string;
  /** The morning after (YYYY-MM-DD). */
  overOn: string;
  /** Where the ranking is, as a path in the web app ("/rank?plan=<id>"). The phone app maps it to its own screen. */
  href: string;
}
export interface RankNudges {
  /** Trips over in the last week or so that haven't been ranked (the apps check the date on the device). */
  recent: RankNudge[];
  /** Dated Pylos trips still to end: the phone schedules a reminder for each morning after. */
  upcoming: RankNudge[];
}

/** Best-first names for prompts: items with a rank score, highest first. */
export function topRanked<T extends { rankScore?: number | null }>(items: readonly T[], n: number): T[] {
  return items
    .filter((x) => typeof x.rankScore === "number")
    .sort((a, b) => b.rankScore! - a.rankScore!)
    .slice(0, n);
}

/** A rank score this high means one of their clear favourites. */
export const TOP_RANK_SCORE = 56;
