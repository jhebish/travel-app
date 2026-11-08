/**
 * Whose places reach a friend's planner, and who gets credit, with an in-memory stand-in for the
 * database: friends are people who follow each other; only friends who share (picks_for_friends),
 * only places tied to their trips that aren't private, and nothing dated in the future.
 */
import type { Itinerary } from "@travel/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as { table: string; op: string; rows: Row[] }[],
  /** Make every query on this table fail with this code (a missing column or table). */
  fail: null as { table: string; code: string } | null,
}));

/** Just enough of the PostgREST query builder for lib/friends.ts. */
class Query implements PromiseLike<unknown> {
  private filters: ((r: Row) => boolean)[] = [];
  private one: "single" | "maybe" | null = null;
  private max = Infinity;
  private write: { op: string; rows: Row[] } | null = null;
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  upsert(rows: Row | Row[]) {
    this.write = { op: "upsert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  insert(rows: Row | Row[]) {
    this.write = { op: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  then<A, B>(done?: ((v: unknown) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(done, fail);
  }
  private run() {
    if (h.fail?.table === this.table) return { data: null, error: { code: h.fail.code, message: "missing" } };
    if (this.write) {
      h.writes.push({ table: this.table, ...this.write });
      return { data: null, error: null };
    }
    const rows = (h.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r))).slice(0, this.max);
    if (this.one) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}
vi.mock("./supabase/server", () => ({ supabaseAdmin: () => ({ from: (t: string) => new Query(t) }) }));

const { friendSource, friendsWhoveBeen } = await import("./friends");

const ME = "u-me";
const profile = (user_id: string, display_name: string, home_city = "", picks_for_friends = true) => ({ user_id, handle: display_name.toLowerCase().split(" ")[0], display_name, home_city, picks_for_friends });
const trip = (id: string, user_id: string, city: string, year: number, visibility = "followers", extra: Row = {}) => ({
  id,
  user_id,
  city,
  city_key: city.toLowerCase(),
  country_code: "PT",
  year,
  month: 5,
  visibility,
  hide_dates: false,
  ...extra,
});
const sig = (id: string, user_id: string, past_trip_id: string | null, name: string, extra: Row = {}) => ({
  id,
  user_id,
  past_trip_id,
  kind: "food",
  name,
  note: null,
  lat: null,
  lng: null,
  visited_on: null,
  rating: null,
  liked: true,
  rank_score: null,
  ...extra,
});
const follow = (a: string, b: string) => ({ follower_id: a, followee_id: b });

beforeEach(() => {
  h.fail = null;
  h.writes = [];
  h.tables = {
    community_profiles: [
      profile(ME, "Me Myself"),
      profile("u-sara", "Sara Haddad", "Beirut"),
      profile("u-omar", "Omar Aziz", "", false), // doesn't share
      profile("u-lina", "Lina Saad"), // I follow her; she doesn't follow me
      profile("u-zed", "Zed Karam"),
      profile("u-viewer", "Viewer Person"),
    ],
    follows: [follow(ME, "u-sara"), follow("u-sara", ME), follow(ME, "u-omar"), follow("u-omar", ME), follow(ME, "u-lina"), follow(ME, "u-zed"), follow("u-zed", ME), follow("u-viewer", "u-sara")],
    past_trips: [
      trip("t1", "u-sara", "Lisbon", 2024),
      trip("t2", "u-sara", "Lisbon", 2025, "private"),
      trip("t3", "u-sara", "Lisbon", 2099), // not yet
      trip("t5", "u-omar", "Lisbon", 2024, "public"),
      trip("t6", "u-lina", "Lisbon", 2024, "public"),
      trip("t7", "u-zed", "Lisbon", 2023, "followers", { hide_dates: true }),
      trip("t8", "u-zed", "Lisbon", 2021),
      trip("t9", "u-zed", "Lisbon", 2020, "public"),
      trip("t10", "u-zed", "Porto", 2020),
    ],
    taste_signals: [
      sig("s1", "u-sara", "t1", "Tasca do Chico"),
      sig("s2", "u-sara", "t2", "Secret Bar"), // private trip
      sig("s3", "u-sara", "t3", "Future Café"), // trip dated in the future
      sig("s4", "u-sara", "t1", "Meh Place", { liked: false }),
      sig("s5", "u-sara", "t1", "Lisbon", { kind: "city" }),
      sig("s6", "u-sara", null, "Loose Place"), // not tied to a trip
      sig("s7", "u-omar", "t5", "Omar's Spot"), // doesn't share
      sig("s8", "u-lina", "t6", "Lina's Spot"), // not a friend
      sig("s9", "u-zed", "t7", "Park", { kind: "drink", liked: null, rating: 5 }),
      sig("s10", "u-zed", "t8", "Ranked High", { liked: null, rank_score: 90 }),
      sig("s11", "u-zed", "t10", "Porto Low", { liked: null, rank_score: 10 }),
      sig("s12", "u-zed", "t10", "Porto Mid", { liked: null, rank_score: 20 }),
      sig("s13", "u-zed", "t8", "Ranked Low", { liked: null, rank_score: 15 }), // below the top third of Zed's ranking
      sig("s14", "u-zed", "t8", "Visit To Come", { visited_on: "2099-01-01" }),
      sig("s15", "u-lina", "t1", "Someone Else's Row On Sara's Trip"),
    ],
    asks: [
      { id: "a1", asker_id: ME, friend_id: "u-omar", city_key: "lisbon", status: "answered", answer_places: [{ name: "Omar's Answer", kind: "food", note: "", mapsUrl: null }] },
      { id: "a2", asker_id: ME, friend_id: "u-zed", city_key: "lisbon", status: "open", answer_places: [{ name: "Not Answered Yet" }] },
    ],
  };
});

const itinerary = (stops: { name: string; candidateId?: string | null; friend?: { name: string } }[]): Itinerary => ({
  title: "Lisbon",
  summary: "",
  notes: [],
  replaced: [],
  hotels: [],
  days: [{ label: "Day 1", theme: "", stops: stops.map((s) => ({ time: "", neighborhood: "", why: "", localTip: "", source: "friends", ...s })) }],
});

describe("friends' places for the planner", () => {
  it("uses only friends who share, from trips that aren't private or in the future, and answers to my questions", async () => {
    const cands = await friendSource(ME).candidates("Lisbon, Portugal");
    expect(cands.map((c) => c.name).sort()).toEqual(["Omar's Answer", "Park", "Ranked High", "Tasca do Chico"]);
    const by = (n: string) => cands.find((c) => c.name === n)!;
    expect(by("Tasca do Chico").friends).toEqual([{ userId: "u-sara", name: "Sara Haddad", local: false, from: "loved" }]);
    // Zed has been three times: a local there.
    expect(by("Park").friends![0]).toMatchObject({ userId: "u-zed", local: true });
    expect(by("Park").category).toBe("drink");
    // Omar doesn't share his places, but he answered my question about Lisbon.
    expect(by("Omar's Answer").friends![0]).toMatchObject({ userId: "u-omar", from: "ask" });
    expect(cands.every((c) => c.source === "friends" && c.origin === "friend")).toBe(true);
  });

  it("returns nothing for guests, cities nobody's been to, or before the migration", async () => {
    expect(await friendSource(ME, { guest: true }).candidates("Lisbon")).toEqual([]);
    expect(await friendSource(ME).candidates("Kyoto")).toEqual([]);
    h.fail = { table: "community_profiles", code: "42703" };
    expect(await friendSource(ME).candidates("Lisbon")).toEqual([]);
  });

  it("lists friends who've been, locals first, hiding dates when asked", async () => {
    const ctx = { user: { id: ME }, db: null, role: "traveler" } as never;
    const list = await friendsWhoveBeen(ctx, "Lisbon");
    expect(list.map((f) => f.person.displayName)).toEqual(["Zed Karam", "Sara Haddad"]);
    expect(list[0]).toMatchObject({ local: true, trips: [{ when: null }, { when: "May 2021" }, { when: "May 2020" }] });
    expect(list[1]).toMatchObject({ local: false, trips: [{ when: "May 2024" }], loved: [{ name: "Tasca do Chico", kind: "food" }] });
    // A friend who lives there is listed even without a logged trip.
    expect((await friendsWhoveBeen(ctx, "Beirut")).map((f) => f.person.displayName)).toEqual(["Sara Haddad"]);
    expect(await friendsWhoveBeen({ user: { id: ME, is_anonymous: true }, db: null, role: "traveler" } as never, "Lisbon")).toEqual([]);
  });
});

describe("credit when friends' picks help", () => {
  it("credits each friend whose pick made it into the trip, once, and never the traveler", async () => {
    const src = friendSource(ME);
    const cands = await src.candidates("Lisbon");
    const id = (n: string) => cands.find((c) => c.name === n)!.id;
    await src.credit({
      id: "trip-1",
      user_id: ME,
      itinerary: itinerary([
        { name: "Tasca do Chico", candidateId: id("Tasca do Chico"), friend: { name: "Sara Haddad" } },
        { name: "Park", candidateId: id("Park"), friend: { name: "Zed Karam" } },
        { name: "Park again", candidateId: id("Park"), friend: { name: "Zed Karam" } },
        { name: "Ranked High", candidateId: id("Ranked High") }, // grounding didn't keep it as a friend's pick
        { name: "Castelo", candidateId: "gp_1" },
      ]),
    });
    const rows = h.writes.filter((w) => w.table === "pick_credits").flatMap((w) => w.rows);
    expect(rows).toEqual([
      { owner_id: "u-sara", beneficiary_id: ME, kind: "itinerary", ref: "trip-1", city_key: "lisbon" },
      { owner_id: "u-zed", beneficiary_id: ME, kind: "itinerary", ref: "trip-1", city_key: "lisbon" },
    ]);
  });

  it("writes nothing when no friend's pick is in the trip", async () => {
    const src = friendSource(ME);
    await src.candidates("Lisbon");
    await src.credit({ id: "trip-2", user_id: ME, itinerary: itinerary([{ name: "Castelo", candidateId: "gp_1" }]) });
    expect(h.writes).toEqual([]);
  });
});

describe("plan a trip like this", () => {
  it("passes a followers-only trip's loved places to someone who follows its owner, and credits the owner", async () => {
    const src = friendSource("u-viewer", { like: "11111111-1111-4111-8111-111111111111" });
    h.tables.past_trips!.push(trip("11111111-1111-4111-8111-111111111111", "u-sara", "Lisbon", 2024));
    h.tables.taste_signals!.push(sig("s20", "u-sara", "11111111-1111-4111-8111-111111111111", "Copied Café", { kind: "coffee" }));
    const cands = await src.candidates("Lisbon");
    expect(cands.map((c) => c.name)).toEqual(["Copied Café"]);
    expect(cands[0]!.friends![0]).toMatchObject({ userId: "u-sara", from: "like" });
    await src.credit({ id: "trip-3", user_id: "u-viewer", itinerary: itinerary([{ name: "Copied Café", candidateId: cands[0]!.id, friend: { name: "Sara" } }]) });
    const rows = h.writes.flatMap((w) => w.rows);
    expect(rows).toContainEqual({ owner_id: "u-sara", beneficiary_id: "u-viewer", kind: "plan_like", ref: "11111111-1111-4111-8111-111111111111", city_key: "lisbon" });
    expect(rows).toContainEqual({ owner_id: "u-sara", beneficiary_id: "u-viewer", kind: "itinerary", ref: "trip-3", city_key: "lisbon" });
  });

  it("ignores a trip the traveler may not see, and a planned-again trip of their own gets no credit", async () => {
    const PRIV = "22222222-2222-4222-8222-222222222222";
    h.tables.past_trips!.push(trip(PRIV, "u-sara", "Lisbon", 2024, "private"));
    h.tables.taste_signals!.push(sig("s21", "u-sara", PRIV, "Private Place"));
    const other = friendSource("u-viewer", { like: PRIV });
    expect(await other.candidates("Lisbon")).toEqual([]);
    await other.credit({ id: "trip-4", user_id: "u-viewer", itinerary: itinerary([]) });
    // Sara planning like her own private trip: allowed, but her own places stay out of the friends source.
    const own = friendSource("u-sara", { like: PRIV });
    expect((await own.candidates("Lisbon")).map((c) => c.name)).not.toContain("Private Place");
    await own.credit({ id: "trip-5", user_id: "u-sara", itinerary: itinerary([]) });
    expect(h.writes).toEqual([]);
  });

  it("lets a guest plan like a public trip, without friends or credits", async () => {
    const PUB = "44444444-4444-4444-8444-444444444444";
    h.tables.past_trips!.push(trip(PUB, "u-zed", "Lisbon", 2024, "public"));
    h.tables.taste_signals!.push(sig("s23", "u-zed", PUB, "Zed's Public Pick"));
    const src = friendSource("u-guest", { guest: true, like: PUB });
    const cands = await src.candidates("Lisbon");
    expect(cands.map((c) => c.name)).toEqual(["Zed's Public Pick"]);
    await src.credit({ id: "trip-6", user_id: "u-guest", itinerary: itinerary([{ name: "Zed's Public Pick", candidateId: cands[0]!.id, friend: { name: "Zed" } }]) });
    expect(h.writes).toEqual([]);
  });

  it("doesn't let a followers-only trip through for someone who doesn't follow its owner", async () => {
    const F = "33333333-3333-4333-8333-333333333333";
    h.tables.past_trips!.push(trip(F, "u-zed", "Lisbon", 2024));
    h.tables.taste_signals!.push(sig("s22", "u-zed", F, "Zed Only"));
    expect((await friendSource("u-viewer", { like: F }).candidates("Lisbon")).map((c) => c.name)).toEqual([]);
  });
});
