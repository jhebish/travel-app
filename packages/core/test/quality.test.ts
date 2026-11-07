import { describe, expect, it } from "vitest";
import {
  OutlineSchema,
  StopSchema,
  TripRequestSchema,
  blendWeights,
  buildOutlinePrompt,
  buildPlanDayPrompt,
  checkDay,
  dayCheckOptions,
  dayFixText,
  defaultWeights,
  mostVisitedBlock,
  placesQueries,
  sameSight,
  scoreCandidate,
  selectCandidates,
  stopRole,
  type Candidate,
  type StopRole,
} from "../src";

const day = (...stops: [string, StopRole][]) => stops.map(([name, role]) => ({ name, role }));

describe("checkDay", () => {
  it("rejects the Algiers day: four cafés and nothing to see", () => {
    const codes = checkDay(day(["Café Tantonville", "coffee"], ["Milk Bar", "coffee"], ["Pâtisserie Aïn Taya", "coffee"], ["Café El Bahdja", "coffee"])).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["coffee", "few_sights", "food_in_a_row"]));
  });

  it("passes a balanced day", () => {
    const ok = day(["Café Tantonville", "coffee"], ["Casbah of Algiers", "see"], ["El Djazair", "meal"], ["Jardin d'Essai du Hamma", "see"], ["La Pêcherie", "meal"]);
    expect(checkDay(ok)).toEqual([]);
  });

  it("flags two cafés in a row even within the limit on a packed day", () => {
    const packed = day(["A", "see"], ["Café 1", "coffee"], ["Café 2", "coffee"], ["B", "do"], ["Lunch", "meal"], ["C", "see"]);
    expect(checkDay(packed).map((i) => i.code)).toEqual(["coffee_in_a_row"]);
  });

  it("checks short arrival days only for repeats", () => {
    expect(checkDay(day(["Dinner", "meal"], ["Bar", "drinks"]))).toEqual([]);
  });

  it("lets a café or food day be one, when the traveler asked", () => {
    const crawl = day(["Café 1", "coffee"], ["Café 2", "coffee"], ["Bakery", "coffee"], ["Lunch", "meal"]);
    expect(checkDay(crawl, dayCheckOptions(["a coffee crawl please"]))).toEqual([]);
    expect(checkDay(crawl, dayCheckOptions(["anniversary"]))).not.toEqual([]);
  });

  it("requires the day's essential sight", () => {
    const egypt = day(["Mena House breakfast", "meal"], ["Giza Pyramid Complex", "see"], ["Koshary Abou Tarek", "meal"], ["Egyptian Museum", "see"]);
    expect(checkDay(egypt, { mustSee: ["Pyramids of Giza"] })).toEqual([]);
    const without = egypt.filter((s) => !s.name.startsWith("Giza"));
    const issues = checkDay(without, { mustSee: ["Pyramids of Giza"] });
    expect(issues.map((i) => i.code)).toContain("must_see");
    expect(dayFixText(issues)).toMatch(/Pyramids of Giza/);
  });
});

describe("sameSight", () => {
  it("matches the same sight under different names", () => {
    expect(sameSight("Pyramids of Giza", "Great Pyramid of Giza")).toBe(true);
    expect(sameSight("Pyramids of Giza", "Giza Pyramid Complex")).toBe(true);
    expect(sameSight("The Colosseum", "Colosseum")).toBe(true);
  });
  it("doesn't match different sights that share a generic word", () => {
    expect(sameSight("Egyptian Museum", "Coptic Museum")).toBe(false);
    expect(sameSight("Royal Palace", "Palace of Fine Arts")).toBe(false);
  });
});

describe("stopRole", () => {
  it("trusts Google's place types over the model's kind", () => {
    expect(stopRole({ name: "Tantonville", kind: "meal" }, ["cafe", "food", "point_of_interest"])).toBe("coffee");
  });
  it("uses the model's kind when there are no types", () => {
    expect(stopRole({ name: "Chez Ali", kind: "meal" })).toBe("meal");
    expect(stopRole({ name: "Bab El Oued walk", kind: "activity" })).toBe("do");
  });
  it("falls back to the name", () => {
    expect(stopRole({ name: "Café de la Paix" })).toBe("coffee");
  });
  it("accepts and drops unknown kinds in stored stops", () => {
    const base = { time: "09:00", name: "X", source: "locals" };
    expect(StopSchema.parse({ ...base, kind: "sight" }).kind).toBe("sight");
    expect(StopSchema.parse({ ...base, kind: "spaceship" }).kind).toBeUndefined();
  });
});

const req = TripRequestSchema.parse({ destination: "Egypt", days: 2, party: "Couple", budget: "Mid-range", pace: "Balanced" });
const eff = blendWeights({ weights: defaultWeights(), blocked: [] }, { useCustom: false, weights: {}, blocked: [] });

describe("candidates", () => {
  it("always searches for the sights, whatever the interests", () => {
    expect(placesQueries(req).map((q) => q.query)).toContain("top attractions in Egypt");
  });

  it("keeps the shortlist from filling up with cafés", () => {
    const cafes: Candidate[] = Array.from({ length: 30 }, (_, i) => ({ id: `lp_${i}`, origin: "local_pick", name: `Café ${i}`, category: "food", source: "locals" }));
    const sights: Candidate[] = Array.from({ length: 5 }, (_, i) => ({ id: `gp_${i}`, origin: "google", name: `Sight ${i}`, category: "culture", source: "reviews", tags: ["tourist_attraction"] }));
    const picked = selectCandidates([...cafes, ...sights], eff, req);
    expect(picked.filter((c) => c.name.startsWith("Café")).length).toBe(8);
    expect(picked.filter((c) => c.name.startsWith("Sight")).length).toBe(5);
  });

  it("no longer marks down famous sights for their many reviews", () => {
    const pyramids: Candidate = { id: "gp_p", origin: "google", name: "Pyramids of Giza", category: "culture", source: "reviews", rating: 4.6, ratingCount: 150000 };
    const quiet = { ...pyramids, id: "gp_q", name: "Quiet sight", ratingCount: 300 };
    expect(scoreCandidate(pyramids, eff, req)).toBeGreaterThan(scoreCandidate(quiet, eff, req));
    const trap: Candidate = { ...pyramids, id: "gp_t", name: "Tourist Restaurant", category: "food", ratingCount: 20000 };
    expect(scoreCandidate(trap, eff, req)).toBeLessThan(scoreCandidate({ ...trap, ratingCount: 300 }, eff, req));
  });
});

describe("essentials in the prompts", () => {
  const cands: Candidate[] = [
    { id: "gp_p", origin: "google", name: "Pyramids of Giza", category: "culture", source: "reviews", ratingCount: 150000 },
    { id: "gp_m", origin: "google", name: "Egyptian Museum", category: "culture", source: "reviews", ratingCount: 60000 },
    { id: "gp_c", origin: "google", name: "Café Riche", category: "food", source: "reviews", ratingCount: 5000 },
  ];

  it("lists the most visited sights, not restaurants", () => {
    const block = mostVisitedBlock(cands);
    expect(block).toMatch(/Pyramids of Giza \(150,000 reviews\)/);
    expect(block).not.toMatch(/Café Riche/);
  });

  it("asks the outline for essentials and a single base for a short country trip", () => {
    const p = buildOutlinePrompt(req, eff, { alwaysFeature: "", neverRecommend: "" }, cands);
    expect(p).toMatch(/ESSENTIALS/);
    expect(p).toMatch(/mustSee/);
    expect(p).toMatch(/Egypt in 2 days: Cairo and Giza/);
  });

  it("makes the day include its essential, and passes a rejected draft back", () => {
    const outline = OutlineSchema.parse({ title: "Cairo", days: [{ label: "Day 1", theme: "Giza", area: "Giza", candidateIds: ["gp_p"], mustSee: ["Pyramids of Giza"] }] });
    const p = buildPlanDayPrompt(req, eff, { alwaysFeature: "", neverRecommend: "" }, outline, 0, cands, "", { draft: "1. 09:00 Café Riche (coffee)", problems: "- It has 4 cafés." });
    expect(p).toMatch(/Must include Pyramids of Giza/);
    expect(p).toMatch(/A FIRST DRAFT OF THIS DAY WAS REJECTED/);
    expect(p).toMatch(/At most one café or coffee stop/);
  });

  it("keeps old outlines without mustSee working", () => {
    expect(OutlineSchema.parse({ title: "x", days: [{ label: "Day 1", theme: "t", area: "a", candidateIds: [] }] }).days[0]!.mustSee).toEqual([]);
  });
});
