import { z } from "zod";
import { HANDLE_RE, cityLabel, type PersonDTO } from "./community";
import { guessKind } from "./imports/kind";
import { hashString, nameKey } from "./imports/text";
import { SIGNAL_KINDS, type SignalKind } from "./labels";
import { MONTH_NAMES } from "./prompts";
import type { Candidate, CandidateCategory } from "./ranking";
import { cityKey } from "./stats";

/**
 * Friends who've been: the places friends loved in a city become planner candidates (the
 * "friends" source), friends who live there or keep going back are its locals, and friends can
 * be asked about a city. "Friends" are people who follow each other. Everything here is plain
 * logic; the server decides who may see what (apps/web/src/lib/friends.ts).
 */

// ---------------------------------------------------------------------------
// Dates: nothing from trips that haven't happened yet
// ---------------------------------------------------------------------------

/** A past trip logged for a year (and month) that's still ahead. */
export function isFutureTrip(t: { year?: number | null; month?: number | null }, now = new Date()): boolean {
  if (!t.year) return false;
  const y = now.getUTCFullYear();
  return t.year > y || (t.year === y && t.month != null && t.month > now.getUTCMonth() + 1);
}

/** A visit dated after today (YYYY-MM-DD). */
export const isFutureDay = (d: string | null | undefined, now = new Date()) => !!d && d.slice(0, 10) > now.toISOString().slice(0, 10);

/** "May 2024", "2024", or null when there's no year or its owner hides dates. */
export function tripWhen(t: { year?: number | null; month?: number | null; hideDates?: boolean | null }): string | null {
  if (t.hideDates || !t.year) return null;
  return t.month && t.month >= 1 && t.month <= 12 ? `${MONTH_NAMES[t.month - 1]} ${t.year}` : String(t.year);
}

// ---------------------------------------------------------------------------
// Local experts
// ---------------------------------------------------------------------------

/** Past trips to a city that make someone a local there. */
export const LOCAL_TRIPS = 3;

export interface LocalInput {
  homeCity?: string | null;
  /** Their past trips (the caller passes only the ones the viewer may count). */
  trips: { city: string; year?: number | null; month?: number | null }[];
}

/**
 * The cities someone is a local for: their home city, then any city they've logged three or more
 * past trips to (trips dated in the future don't count), most trips first.
 */
export function localExpertCities(p: LocalInput, now = new Date()): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const home = p.homeCity ? cityKey(p.homeCity) : "";
  if (home) out.push({ key: home, label: p.homeCity!.split(",")[0]!.trim() });
  const counts = new Map<string, { label: string; n: number }>();
  for (const t of p.trips) {
    if (isFutureTrip(t, now)) continue;
    const k = cityKey(t.city);
    if (!k) continue;
    const c = counts.get(k) ?? { label: t.city.split(",")[0]!.trim(), n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const often = [...counts.entries()].filter(([k, c]) => c.n >= LOCAL_TRIPS && k !== home).sort((a, b) => b[1].n - a[1].n);
  return [...out, ...often.map(([key, c]) => ({ key, label: c.label }))];
}

export function isLocalFor(city: string, p: LocalInput, now = new Date()): boolean {
  const k = cityKey(city);
  return !!k && localExpertCities(p, now).some((c) => c.key === k);
}

// ---------------------------------------------------------------------------
// Loved places
// ---------------------------------------------------------------------------

/**
 * The rank score from which someone's places count as loved: their top third. Null with fewer
 * than three ranked places (too few comparisons to say). Scores are only compared with the
 * same person's own, so their scale doesn't matter.
 */
export function lovedRankThreshold(scores: (number | null | undefined)[]): number | null {
  const s = scores.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => b - a);
  if (s.length < 3) return null;
  return s[Math.ceil(s.length / 3) - 1]!;
}

/** Liked, rated 4 or 5, or high in their own ranking; never a place they didn't like. */
export function isLoved(s: { liked?: boolean | null; rating?: number | null; rankScore?: number | null }, threshold: number | null): boolean {
  if (s.liked === false || (s.rating != null && s.rating <= 2)) return false;
  if (s.liked === true || (s.rating != null && s.rating >= 4)) return true;
  return threshold != null && s.rankScore != null && s.rankScore >= threshold;
}

// ---------------------------------------------------------------------------
// Friends' places as planner candidates
// ---------------------------------------------------------------------------

/** "loved": from their past trips. "ask": their answer to your question. "like": the trip you're planning one like. */
export type FriendFrom = "loved" | "ask" | "like";

/** One friend behind a candidate. Server side only: the itinerary keeps just the name (FriendPick). */
export interface FriendCredit {
  userId: string;
  name: string;
  local: boolean;
  from: FriendFrom;
}

export interface FriendPlace {
  credit: FriendCredit;
  name: string;
  kind?: SignalKind | null;
  note?: string | null;
}

const KIND_CATEGORY: Record<SignalKind, CandidateCategory | null> = {
  stay: "stay",
  food: "food",
  coffee: "food",
  drink: "drink",
  nightlife: "nightlife",
  sight: "culture",
  activity: "other",
  shop: "shopping",
  city: null,
};
/** A place type for each kind, so the day check reads a friend's café as coffee. */
const KIND_TAG: Partial<Record<SignalKind, string>> = { coffee: "cafe", food: "restaurant", drink: "bar", nightlife: "night_club", stay: "lodging", sight: "tourist_attraction" };

const FROM_RANK: Record<FriendFrom, number> = { like: 3, ask: 2, loved: 1 };

/** Stable within a city, so later edits of a trip see the same id for the same place. */
export const friendCandidateId = (city: string, name: string) => `fr_${hashString(`${cityKey(city)}|${nameKey(name)}`).slice(0, 8)}`;

/**
 * Friends' places in one city as candidates, one per place (two friends who loved the same
 * café share one, with both credited). Strongest first: places from the trip they're planning
 * one like, then answers to their questions, then places more friends loved.
 */
export function friendCandidates(places: FriendPlace[], city: string, opts: { staysOnly?: boolean; max?: number } = {}): Candidate[] {
  const by = new Map<string, { c: Candidate; credits: FriendCredit[]; order: number }>();
  places.forEach((p, order) => {
    const name = p.name.trim().slice(0, 160);
    const key = nameKey(name);
    if (!key || p.kind === "city") return;
    const kind = p.kind ?? guessKind(name);
    const category = KIND_CATEGORY[kind];
    if (!category || (opts.staysOnly && category !== "stay")) return;
    let e = by.get(key);
    if (!e) {
      const tag = KIND_TAG[kind];
      e = { c: { id: friendCandidateId(city, name), origin: "friend", name, category, source: "friends", tags: tag ? [tag] : [] }, credits: [], order };
      by.set(key, e);
    }
    if (!e.c.note && p.note?.trim()) e.c.note = p.note.trim().slice(0, 200);
    const had = e.credits.find((c) => c.userId === p.credit.userId);
    if (!had) e.credits.push({ ...p.credit });
    else if (FROM_RANK[p.credit.from] > FROM_RANK[had.from]) had.from = p.credit.from;
  });
  const strength = (credits: FriendCredit[]) => Math.max(...credits.map((c) => FROM_RANK[c.from])) * 10 + credits.length + (credits.some((c) => c.local) ? 0.5 : 0);
  return [...by.values()]
    .sort((a, b) => strength(b.credits) - strength(a.credits) || a.order - b.order)
    .slice(0, opts.max ?? 40)
    .map((e) => ({ ...e.c, friends: e.credits }));
}

/**
 * Friends' candidates ahead of the rest. A friend's place that a Places search (or a local pick)
 * also found takes the search's map details and place id, so it keeps the friend's credit and
 * needn't be looked up again. The search's copy stays behind it: selectCandidates keeps the
 * friend's (same place id, first), unless the traveler has turned friends off.
 */
export function withFriendCandidates(friends: Candidate[], others: Candidate[]): Candidate[] {
  if (!friends.length) return others;
  const used = new Set<Candidate>();
  const merged = friends.map((f): Candidate => {
    const k = nameKey(f.name);
    const twin = others.find((o) => !used.has(o) && ((!!f.placeId && o.placeId === f.placeId) || nameKey(o.name) === k));
    if (!twin) return f;
    used.add(twin);
    return {
      ...f,
      neighborhood: f.neighborhood || twin.neighborhood,
      placeId: f.placeId ?? twin.placeId,
      verification: f.verification ?? twin.verification,
      rating: twin.rating,
      ratingCount: twin.ratingCount,
      priceLevel: twin.priceLevel,
      tags: [...new Set([...(twin.tags ?? []), ...(f.tags ?? [])])],
      stayStyle: twin.stayStyle ?? f.stayStyle,
      priceBand: twin.priceBand ?? f.priceBand,
      expediaPropertyId: twin.expediaPropertyId ?? f.expediaPropertyId,
      hot: twin.hot ?? f.hot,
      note: f.note || twin.note,
    };
  });
  return [...merged, ...others];
}

/** A friend's candidate with the same name, for a pick the model named without its id. */
export function matchFriendCandidate(cands: readonly Candidate[], name: string): Candidate | undefined {
  const k = nameKey(name);
  return k ? cands.find((c) => c.origin === "friend" && nameKey(c.name) === k) : undefined;
}

/**
 * Ranking: on top of the friends source's weight. A place from the trip they're planning one
 * like, or a friend's answer to their question, is close to a sure thing; a loved place counts
 * like a vetted local pick. A local friend, and more friends, count a little more.
 */
export function friendBonus(credits: readonly FriendCredit[]): number {
  if (!credits.length) return 0;
  const has = (f: FriendFrom) => credits.some((c) => c.from === f);
  let b = has("like") ? 0.35 : has("ask") ? 0.3 : 0.1;
  if (credits.some((c) => c.local)) b += 0.05;
  b += Math.min(0.1, 0.05 * (new Set(credits.map((c) => c.userId)).size - 1));
  return b;
}

/** What a stop shows: the friend it's credited to (a local first) and how many more loved it. */
export function friendBadge(credits: readonly FriendCredit[]): { name: string; local?: boolean; more?: number } | undefined {
  if (!credits.length) return undefined;
  const lead = [...credits].sort((a, b) => FROM_RANK[b.from] - FROM_RANK[a.from] || Number(b.local) - Number(a.local))[0]!;
  const others = new Set(credits.map((c) => c.userId)).size - 1;
  return { name: lead.name.trim().slice(0, 60) || "A friend", ...(lead.local ? { local: true } : {}), ...(others > 0 ? { more: Math.min(50, others) } : {}) };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/** "Sara's pick", or "Sara's pick, and 2 more". */
export const friendPickLabel = (f: { name: string; more?: number }) => `${firstName(f.name)}'s pick${f.more ? `, and ${f.more} more` : ""}`;

// ---------------------------------------------------------------------------
// Ask a friend
// ---------------------------------------------------------------------------

export const ASK_MAX_PLACES = 12;
/** Questions someone can send in a day. */
export const ASKS_PER_DAY = 20;

/** The question an "Ask Sara" button starts with; they can edit it before sending. */
export function askQuestion(city: string, month?: number | null): string {
  const c = city.split(",")[0]!.trim() || city.trim();
  return month && month >= 1 && month <= 12 ? `Going to ${c} in ${MONTH_NAMES[month - 1]}. Any favourites?` : `Going to ${c} soon. Any favourites?`;
}

export const mapsSearchUrl = (name: string, city: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city ? `${name}, ${city}` : name)}`;

export const AskCreateSchema = z.object({
  /** The friend's handle. */
  to: z.string().trim().toLowerCase().regex(HANDLE_RE),
  city: z.string().trim().min(1).max(80),
  question: z.string().trim().min(1).max(500),
  /** The asker's trip the answer is saved into; optional (they can ask before planning). */
  tripId: z.string().uuid().nullable().optional(),
});
export type AskCreate = z.infer<typeof AskCreateSchema>;

export const AskPlaceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(SIGNAL_KINDS).nullable().optional(),
  note: z.string().trim().max(200).default(""),
  /** One of the answerer's own logged places (a taste signal): the server fills in its details. */
  signalId: z.string().uuid().optional(),
});

export const AskReplySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("answer"),
    answer: z.string().trim().max(1500).default(""),
    places: z.array(AskPlaceInputSchema).max(ASK_MAX_PLACES).default([]),
  }),
  z.object({ action: z.literal("decline") }),
]);

export interface AskPlace {
  name: string;
  kind: SignalKind | null;
  note: string;
  mapsUrl: string | null;
}

const StoredAskPlace = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(SIGNAL_KINDS).nullable().optional().catch(null),
  note: z.string().max(400).optional().catch(""),
  mapsUrl: z.string().url().max(500).nullable().optional().catch(null),
});

/** An answer's places as stored (jsonb): the ones that still read cleanly, at most 12. */
export function askPlacesFrom(raw: unknown): AskPlace[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((x) => {
      const r = StoredAskPlace.safeParse(x);
      return r.success ? [{ name: r.data.name, kind: r.data.kind === "city" ? null : (r.data.kind ?? null), note: r.data.note ?? "", mapsUrl: r.data.mapsUrl ?? null }] : [];
    })
    .slice(0, ASK_MAX_PLACES);
}

export type AskStatus = "open" | "answered" | "declined";

export interface AskDTO {
  id: string;
  city: string;
  question: string;
  status: AskStatus;
  answer: string;
  places: AskPlace[];
  tripId: string | null;
  createdAt: string;
  answeredAt: string | null;
  /** The other side: who asked (for asks you received) or who you asked (for asks you sent). */
  person: PersonDTO;
  /** Asks you sent: answered since you last looked. */
  isNew?: boolean;
}

/** A friend who's been to a city, as "Friends who've been" shows them. */
export interface BeenFriend {
  person: PersonDTO;
  local: boolean;
  /** Their trips there, newest first; `when` is null when they hide dates. */
  trips: { when: string | null }[];
  loved: { name: string; kind: SignalKind }[];
}

/** "Plan a trip like this": the past trip it starts from. */
export interface LikeTrip {
  id: string;
  city: string;
  destination: string;
  ownerName: string;
  mine: boolean;
}

export interface CreditSummary {
  /** Different friends your picks helped. */
  friends: number;
  cities: { key: string; label: string; uses: number }[];
}

export interface FriendsMe {
  picksForFriends: boolean;
  localCities: { key: string; label: string }[];
  credits: CreditSummary;
}

/** "Your picks helped 4 friends", and a line per city ("Lisbon: used 3 times"). */
export function creditSummary(rows: { beneficiaryId: string; cityKey: string }[]): CreditSummary {
  const cities = new Map<string, number>();
  for (const r of rows) if (r.cityKey) cities.set(r.cityKey, (cities.get(r.cityKey) ?? 0) + 1);
  return {
    friends: new Set(rows.map((r) => r.beneficiaryId)).size,
    cities: [...cities.entries()]
      .map(([key, uses]) => ({ key, label: cityLabel(key), uses }))
      .sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label)),
  };
}
