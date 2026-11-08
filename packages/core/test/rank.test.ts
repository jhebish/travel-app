import { describe, expect, it } from "vitest";
import {
  NUDGE_DAYS,
  TOP_RANK_SCORE,
  addDays,
  buildTastePrompt,
  comparisonCounts,
  daysBetween,
  nextPair,
  nudgeDue,
  pairKey,
  rankByGroup,
  rankOpensAt,
  rankOrder,
  rankScores,
  rankSignals,
  signalRankGroup,
  stopRankKind,
  tasteForPrompt,
  tasteRanking,
  tripLength,
  tripOverOn,
  type RankItem,
  type RankVote,
  type TasteSignal,
} from "../src";

const v = (winner: string, loser: string): RankVote => ({ winner, loser });
const food = (...ids: string[]): RankItem[] => ids.map((id) => ({ id, group: "food" }));

/** Answer every question the way a fixed true order would, for `n` questions. */
function play(items: RankItem[], truth: string[], n: number, votes: RankVote[] = []) {
  const asked: [string, string][] = [];
  for (let k = 0; k < n; k++) {
    const p = nextPair(items, votes);
    if (!p) break;
    asked.push(p);
    const [a, b] = p;
    votes = [...votes, truth.indexOf(a) < truth.indexOf(b) ? v(a, b) : v(b, a)];
  }
  return { votes, asked };
}

describe("rank scores", () => {
  it("puts the winner above the loser, and leaves uncompared items out", () => {
    const s = rankScores(["a", "b", "c"], [v("a", "b")]);
    expect(s.get("a")!).toBeGreaterThan(50);
    expect(s.get("b")!).toBeLessThan(50);
    expect(s.has("c")).toBe(false);
    expect(rankScores(["a", "b"], []).size).toBe(0);
  });

  it("ignores votes for items that aren't there, and votes for an item against itself", () => {
    const s = rankScores(["a", "b"], [v("a", "b"), v("a", "zz"), v("zz", "b"), v("b", "b")]);
    expect([...s.keys()].sort()).toEqual(["a", "b"]);
    expect(comparisonCounts(["a", "b"], [v("a", "b"), v("a", "zz"), v("b", "b")]).get("a")).toBe(1);
  });

  it("gives the same scores whatever order the answers came in", () => {
    const votes = [v("a", "b"), v("b", "c"), v("c", "d"), v("a", "c"), v("d", "b"), v("a", "d"), v("c", "b")];
    const base = rankScores(["a", "b", "c", "d"], votes);
    for (let i = 0; i < 6; i++) {
      const shuffled = [...votes].sort((x, y) => ((x.winner.charCodeAt(0) * 31 + y.loser.charCodeAt(0) * (i + 3)) % 7) - 3);
      expect(Object.fromEntries(rankScores(["d", "c", "b", "a"], shuffled))).toEqual(Object.fromEntries(base));
    }
  });

  it("recovers a consistent order", () => {
    const votes = [v("a", "b"), v("b", "c"), v("c", "d"), v("d", "e"), v("a", "c"), v("b", "d"), v("c", "e")];
    expect(rankOrder(["e", "d", "c", "b", "a"], votes).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("doesn't let one lucky win beat a long run of wins", () => {
    const votes = [v("lucky", "x"), v("steady", "p"), v("steady", "q"), v("steady", "r"), v("steady", "s")];
    const s = rankScores(["lucky", "steady", "x", "p", "q", "r", "s"], votes);
    expect(s.get("steady")!).toBeGreaterThan(s.get("lucky")!);
    // Scores stay finite and on a readable scale, even when one item has never lost.
    for (const x of s.values()) expect(x).toBeGreaterThan(0), expect(x).toBeLessThan(100);
  });

  it("marks a clean sweep, but not a single win, as a top favourite", () => {
    expect(rankScores(["a", "b"], [v("a", "b")]).get("a")!).toBeLessThan(TOP_RANK_SCORE);
    expect(rankScores(["a", "b", "c", "d"], [v("a", "b"), v("a", "c"), v("a", "d")]).get("a")!).toBeGreaterThan(TOP_RANK_SCORE);
  });

  it("ranks within each group, groups in a fixed order", () => {
    const items = [
      { id: "h1", group: "stay" },
      { id: "h2", group: "stay" },
      { id: "r1", group: "food" },
      { id: "r2", group: "food" },
      { id: "x", group: "food" },
    ];
    const g = rankByGroup(items, [v("r2", "r1"), v("h1", "h2")]);
    expect(g.map((x) => x.group)).toEqual(["stay", "food"]);
    expect(g[1]!.items.map((x) => x.id)).toEqual(["r2", "r1"]);
    expect(g[1]!.items[0]).toMatchObject({ id: "r2", group: "food", comparisons: 1, wins: 1 });
  });
});

describe("the next pair", () => {
  it("only pairs items of the same kind", () => {
    const items = [
      { id: "hotel", group: "stay" },
      { id: "r1", group: "food" },
      { id: "bar", group: "drink" },
      { id: "r2", group: "food" },
    ];
    const p = nextPair(items, []);
    expect(p && [...p].sort()).toEqual(["r1", "r2"]);
    expect(nextPair([{ id: "hotel", group: "stay" }, { id: "r1", group: "food" }], [])).toBeNull();
    expect(nextPair([], [])).toBeNull();
  });

  it("starts with places that haven't been compared, and never asks the same pair twice in a row", () => {
    const items = food("a", "b", "c", "d", "e", "f");
    const first = nextPair(items, [])!;
    const votes = [v(first[0], first[1])];
    const second = nextPair(items, votes)!;
    expect(second.some((x) => first.includes(x))).toBe(false);
    const { asked } = play(items, ["a", "b", "c", "d", "e", "f"], 3);
    expect(new Set(asked.flat()).size).toBe(6); // three questions cover all six places
  });

  it("then compares places that sit close together", () => {
    const items = food("a", "b", "c", "d", "e");
    // Everyone has been compared twice: a is clearly top, e clearly bottom.
    const votes = [v("a", "b"), v("a", "c"), v("b", "d"), v("c", "e"), v("d", "e")];
    const p = nextPair(items, votes)!;
    expect(pairKey(...p)).not.toBe(pairKey("a", "e"));
    const s = rankScores(["a", "b", "c", "d", "e"], votes);
    const gap = Math.abs(s.get(p[0])! - s.get(p[1])!);
    expect(gap).toBeLessThan(Math.abs(s.get("a")! - s.get("e")!) / 2);
  });

  it("is deterministic, and skips the pairs someone couldn't decide on", () => {
    const items = food("a", "b", "c");
    const p = nextPair(items, [v("a", "b")])!;
    expect(nextPair(items, [v("a", "b")])).toEqual(p);
    const skip = new Set([pairKey(...p)]);
    const q = nextPair(items, [v("a", "b")], { skip })!;
    expect(pairKey(...q)).not.toBe(pairKey(...p));
    expect(nextPair(food("a", "b"), [], { skip: [pairKey("a", "b")] })).toBeNull();
  });

  it("learns a true order from a handful of answers", () => {
    const truth = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    const items = food(...[...truth].reverse());
    const { votes } = play(items, truth, 16);
    const order = rankOrder(truth, votes).map((r) => r.id);
    expect(order[0]).toBe("p1");
    expect(order.at(-1)).toBe("p8");
  });
});

describe("what gets compared", () => {
  it("groups places by kind; cities aren't ranked against places", () => {
    expect(signalRankGroup("food")).toBe("food");
    expect(signalRankGroup("nightlife")).toBe(signalRankGroup("drink"));
    expect(signalRankGroup("sight")).toBe(signalRankGroup("activity"));
    expect(signalRankGroup("city")).toBeNull();
  });

  it("reads a plan's stop from its kind, or its name on older plans", () => {
    expect(stopRankKind({ kind: "meal", name: "Somewhere" })).toEqual({ group: "food", noun: "Restaurant" });
    expect(stopRankKind({ kind: "market", name: "Mercado" }).group).toBe("see");
    expect(stopRankKind({ name: "Café Central" }).group).toBe("coffee");
    expect(stopRankKind({ name: "Xyzzy" })).toEqual({ group: "see", noun: "Stop" });
  });
});

describe("trip dates", () => {
  it("knows the morning after", () => {
    expect(tripOverOn("2026-11-01", 3)).toBe("2026-11-04");
    expect(tripOverOn("2026-12-30", 4)).toBe("2027-01-03");
    expect(tripOverOn("2028-02-27", 3)).toBe("2028-03-01"); // a leap year
    expect(tripOverOn(null, 3)).toBeNull();
    expect(tripOverOn("next week", 3)).toBeNull();
    expect(tripOverOn("2026-11-01", 0)).toBe("2026-11-02");
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(daysBetween("2026-11-04", "2026-11-07")).toBe(3);
  });

  it("takes the trip's length from the request, or the plan", () => {
    expect(tripLength({ request: { days: 4 }, itinerary: { days: [1, 2] } })).toBe(4);
    expect(tripLength({ request: null, itinerary: { days: [1, 2] } })).toBe(2);
    expect(tripLength({})).toBe(1);
  });

  it("shows the nudge for a week from the morning after", () => {
    expect(nudgeDue("2026-11-04", "2026-11-03")).toBe(false);
    expect(nudgeDue("2026-11-04", "2026-11-04")).toBe(true);
    expect(nudgeDue("2026-11-04", addDays("2026-11-04", NUDGE_DAYS - 1))).toBe(true);
    expect(nudgeDue("2026-11-04", addDays("2026-11-04", NUDGE_DAYS))).toBe(false);
  });

  it("opens ranking once the morning after has begun anywhere", () => {
    expect(new Date(rankOpensAt("2026-11-04")).toISOString()).toBe("2026-11-03T10:00:00.000Z");
  });
});

describe("ranking feeds taste", () => {
  const sig = (name: string, extra: Partial<TasteSignal> = {}): TasteSignal => ({ source: "manual", ref: name, kind: "food", name, city: "Lisbon", liked: true, ...extra });

  it("moves places they keep choosing up the evidence, and ones that keep losing down", () => {
    const list = [sig("Loser", { rankScore: 38 }), sig("Plain"), sig("Winner", { rankScore: 64 })];
    expect(rankSignals(list).map((s) => s.name)).toEqual(["Winner", "Plain", "Loser"]);
  });

  it("puts their top-ranked trips and places in the taste prompt", () => {
    const ranking = tasteRanking(
      [
        { city: "Kyoto", country: "Japan", year: 2024, rankScore: 48 },
        { city: "Lisbon", country: "Portugal", year: 2025, rankScore: 61 },
        { city: "Unranked", country: "Nowhere", rankScore: null },
      ],
      [
        { name: "Cervejaria Ramiro", city: "Lisbon", group: "food", rankScore: 52 },
        { name: "Taberna da Rua das Flores", city: "Lisbon", group: "food", rankScore: 63 },
        { name: "Taberna da Rua das Flores", city: "Lisbon", group: "food", rankScore: 58 },
        { name: "Memmo Alfama", city: "Lisbon", group: "stay", rankScore: 55 },
      ],
    );
    expect(ranking.trips).toEqual(["Lisbon, Portugal (2025)", "Kyoto, Japan (2024)"]);
    expect(ranking.places).toEqual(["Stays: Memmo Alfama (Lisbon)", "Restaurants: Taberna da Rua das Flores (Lisbon) > Cervejaria Ramiro (Lisbon)"]);
    const prompt = buildTastePrompt({ pastTrips: [], signals: [], feedback: { liked: [], disliked: [] }, ranking });
    expect(prompt).toContain("THEIR OWN RANKING");
    expect(prompt).toContain("Trips: Lisbon, Portugal (2025) > Kyoto, Japan (2024)");
    expect(prompt).toContain("Restaurants: Taberna da Rua das Flores (Lisbon) > Cervejaria Ramiro (Lisbon)");
    expect(buildTastePrompt({ pastTrips: [], signals: [], feedback: { liked: [], disliked: [] } })).not.toContain("THEIR OWN RANKING");
  });

  it("asks the planner to name the favourite and where it was", () => {
    const block = tasteForPrompt([
      { label: null, profile: null, favorites: [sig("Cervejaria Ramiro"), sig("Taberna da Rua das Flores", { rankScore: 66 })] },
    ]);
    expect(block).toContain('"Because you loved Taberna da Rua das Flores in Lisbon"');
    expect(block).toContain("Taberna da Rua das Flores (Lisbon) [top-ranked]");
    expect(block).not.toContain("Cervejaria Ramiro (Lisbon) [top-ranked]");
    expect(block).not.toContain("trip owner");
  });

  it("planning together: only the owner's own favourites are named, since only the owner sees them", () => {
    const block = tasteForPrompt([
      { label: "Trip owner", profile: null, favorites: [sig("Owner's tasca", { city: "Porto" })] },
      { label: "Sara", profile: null, favorites: [sig("Sara's bar", { rankScore: 70, kind: "drink" })] },
    ]);
    expect(block).toContain('"Because you loved Owner\'s tasca in Porto"');
    expect(block).toContain("name only the owner's own favorites");
  });
});
