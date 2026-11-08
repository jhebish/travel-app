/**
 * Imports into Places you've been, with an in-memory stand-in for the caller's database client:
 * new trips are added, ones already logged are skipped, and a longer stay found by a later scan
 * corrects the length logged before (an earlier photo scan counted trips as a day or two).
 */
import { PastTripInputSchema, type PastTripInput } from "@travel/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "./auth";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

/** Just enough of the PostgREST query builder for addPlacesBulk. */
class Query implements PromiseLike<unknown> {
  private filters: ((r: Row) => boolean)[] = [];
  private one = false;
  private max = Infinity;
  private write: { op: "insert" | "update"; rows: Row[] } | null = null;
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.write = { op: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  update(patch: Row) {
    this.write = { op: "update", rows: [patch] };
    return this;
  }
  then<A, B>(done?: ((v: unknown) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(done, fail);
  }
  private run() {
    const table = (h.tables[this.table] ??= []);
    const matching = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.write?.op === "insert") {
      table.push(...this.write.rows.map((r, i) => ({ id: `new-${table.length + i}`, ...r })));
      return { data: null, error: null };
    }
    if (this.write?.op === "update") {
      for (const r of matching) Object.assign(r, this.write.rows[0]);
      return { data: null, error: null };
    }
    const rows = matching.slice(0, this.max);
    return { data: this.one ? (rows[0] ?? null) : rows, error: null };
  }
}
vi.mock("./supabase/server", () => ({ supabaseAdmin: () => ({ from: (t: string) => new Query(t) }) }));

const { addPlacesBulk } = await import("./community");

const ME = "u-me";
const ctx = { user: { id: ME }, db: { from: (t: string) => new Query(t) }, role: "user" } as unknown as Ctx;
const logged = (id: string, user_id: string, city: string, year: number, days: number | null) => ({ id, user_id, city, city_key: city.toLowerCase(), country_code: "PT", year, month: 5, days });
const found = (city: string, year: number, days: number | null): PastTripInput => PastTripInputSchema.parse({ city, countryCode: "PT", year, month: 5, days });
const mine = () => (h.tables.past_trips ?? []).filter((r) => r.user_id === ME);

beforeEach(() => {
  h.tables = {
    community_profiles: [{ user_id: ME, places_public: false }],
    past_trips: [
      logged("t1", ME, "Lisbon", 2025, 1), // the old scan's one day
      logged("t2", ME, "Porto", 2025, 6),
      logged("t3", ME, "Faro", 2024, null),
      logged("t9", "u-other", "Lisbon", 2025, 1),
    ],
  };
});

describe("adding trips from a scan", () => {
  it("adds new trips, skips logged ones, and corrects lengths a later scan found longer", async () => {
    const r = await addPlacesBulk(ctx, [found("Lisbon", 2025, 5), found("Porto", 2025, 3), found("Faro", 2024, 4), found("Sintra", 2025, 2)]);
    expect(r).toEqual({ added: 1, skipped: 3, updated: 2 });
    const days = Object.fromEntries(mine().map((t) => [`${t.city} ${t.year}`, t.days]));
    // Longer wins; a shorter count never lowers what's there.
    expect(days).toEqual({ "Lisbon 2025": 5, "Porto 2025": 6, "Faro 2024": 4, "Sintra 2025": 2 });
    // Only the caller's own rows change.
    expect(h.tables.past_trips!.find((t) => t.id === "t9")!.days).toBe(1);
  });

  it("takes the longest count when a trip appears twice, and changes nothing when nothing is longer", async () => {
    expect(await addPlacesBulk(ctx, [found("Lisbon", 2025, 4), found("Lisbon", 2025, 7), found("Lisbon", 2025, 2)])).toEqual({ added: 0, skipped: 3, updated: 1 });
    expect(mine().find((t) => t.id === "t1")!.days).toBe(7);
    expect(await addPlacesBulk(ctx, [found("Porto", 2025, 6), found("Faro", 2024, null)])).toEqual({ added: 0, skipped: 2, updated: 0 });
  });
});
