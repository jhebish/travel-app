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
  ensureLandmarks,
  famousSights,
  historyForPrompt,
  isReturnVisit,
  mostVisitedBlock,
  placesQueries,
  sameSight,
  scoreCandidate,
  selectCandidates,
  stopRole,
  type Candidate,
  type PastTrip,
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
    expect(checkDay(crawl, dayCheckOptions({ notes: "a coffee crawl please" }))).toEqual([]);
    expect(checkDay(crawl, dayCheckOptions({ notes: "Café-hopping in Le Marais!" }))).toEqual([]);
    expect(checkDay(crawl, dayCheckOptions({ notes: "anniversary" }))).not.toEqual([]);
  });

  it("doesn't relax for a mention of food: dietary notes, or 'Food' among the interests", () => {
    // Interest chips aren't read at all; notes need an explicit food day.
    for (const notes of ["We don't eat pork", "vegetarian, good restaurants nearby", ""]) {
      const opts = dayCheckOptions({ notes });
      expect(opts.foodFocus || opts.coffeeFocus).toBe(false);
      const eating = day(["Breakfast", "meal"], ["Lunch", "meal"], ["Tasting", "meal"], ["Dinner", "meal"]);
      expect(checkDay(eating, opts).map((i) => i.code)).toEqual(expect.arrayContaining(["few_sights", "food_in_a_row"]));
    }
  });

  it("lets foodies eat three in a row, not four", () => {
    const opts = dayCheckOptions({ notes: "We're foodies" });
    expect(opts.foodFocus).toBe(true);
    const three = day(["Market", "do"], ["Breakfast", "meal"], ["Lunch", "meal"], ["Tasting", "meal"], ["Old town", "see"], ["Dinner", "meal"]);
    expect(checkDay(three, opts)).toEqual([]);
    const four = day(["Old town", "see"], ["Breakfast", "meal"], ["Lunch", "meal"], ["Tasting", "meal"], ["Dinner", "meal"]);
    expect(checkDay(four, opts).map((i) => i.code)).toContain("food_in_a_row");
  });

  it("allows a coffee lover a second café, never back to back", () => {
    const opts = dayCheckOptions({ notes: "we love good coffee" });
    expect(opts).toMatchObject({ coffeeLover: true, coffeeFocus: false });
    const spaced = day(["Café 1", "coffee"], ["Museum", "see"], ["Lunch", "meal"], ["Café 2", "coffee"], ["Park", "see"]);
    expect(checkDay(spaced, opts)).toEqual([]);
    expect(checkDay(spaced).map((i) => i.code)).toEqual(["coffee"]);
    const together = day(["Café 1", "coffee"], ["Café 2", "coffee"], ["Museum", "see"], ["Lunch", "meal"], ["Park", "see"]);
    expect(checkDay(together, opts).map((i) => i.code)).toEqual(["coffee_in_a_row"]);
  });

  it("takes a rebuild hint as a direct ask for that day", () => {
    expect(dayCheckOptions({ hint: "more cafés" }).coffeeFocus).toBe(true);
    expect(dayCheckOptions({ hint: "more street food" }).foodFocus).toBe(true);
    expect(dayCheckOptions({ hint: "somewhere quieter" })).toMatchObject({ foodFocus: false, coffeeFocus: false });
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
  it("counts a bakery, pâtisserie or ice cream shop as a café-type break, not a meal", () => {
    expect(stopRole({ name: "Pâtisserie Aïn Taya", kind: "coffee" }, ["bakery", "food", "point_of_interest"])).toBe("coffee");
    expect(stopRole({ name: "Gelateria del Teatro" }, ["ice_cream_shop", "food"])).toBe("coffee");
    expect(stopRole({ name: "Pasticceria Marchesi" })).toBe("coffee");
    expect(stopRole({ name: "Trattoria da Enzo" }, ["restaurant", "food"])).toBe("meal");
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

// Real coordinates: downtown Cairo, the Giza plateau (about 12 km away), and Karnak in Luxor (500 km).
const at = (lat: number, lng: number) => ({ verification: { placeId: `p${lat}`, lat, lng } });
const sight = (id: string, name: string, ratingCount: number, where: ReturnType<typeof at>): Candidate => ({
  id,
  origin: "google",
  name,
  category: "culture",
  source: "reviews",
  ratingCount,
  ...where,
});
const CAIRO = at(30.0444, 31.2357);
const GIZA = at(29.9792, 31.1342);
const LUXOR = at(25.7188, 32.6573);
const egypt: Candidate[] = [
  sight("gp_karnak", "Karnak Temple Complex", 200_000, LUXOR),
  sight("gp_pyr", "Pyramids of Giza", 150_000, GIZA),
  sight("gp_pyr2", "Great Pyramid of Giza", 90_000, GIZA),
  sight("gp_mus", "Egyptian Museum", 60_000, CAIRO),
  sight("gp_cop", "Coptic Cairo", 15_000, at(30.006, 31.2302)),
  { id: "gp_cafe", origin: "google", name: "Café Riche", category: "food", source: "reviews", ratingCount: 30_000, ...CAIRO },
  { id: "lp_kosh", origin: "local_pick", name: "Koshary Abou Tarek", category: "food", source: "locals" },
];
const outlineDays = () => [
  { label: "Day 1", theme: "Downtown", area: "Downtown Cairo", candidateIds: ["gp_mus", "gp_cafe", "lp_kosh"], mustSee: ["Egyptian Museum"] },
  { label: "Day 2", theme: "Old Cairo", area: "Coptic Cairo", candidateIds: ["gp_cop", "lp_kosh"], mustSee: [] as string[] },
];

describe("famous sights, in code", () => {
  it("ranks a place's headline sights, counting two listings of one sight once", () => {
    expect(famousSights(egypt).map((c) => c.id)).toEqual(["gp_karnak", "gp_pyr", "gp_mus"]);
  });

  it("adds the Pyramids to two days in Cairo, and skips Luxor's temples", () => {
    const { days, added } = ensureLandmarks(outlineDays(), egypt, { days: 2 });
    expect(added).toEqual(["Pyramids of Giza"]);
    // Day 2's Coptic Cairo is nearer the plateau than day 1's downtown picks.
    expect(days[1]!.mustSee).toEqual(["Pyramids of Giza"]);
    expect(days[1]!.candidateIds).toContain("gp_pyr");
    expect(days.flatMap((d) => d.mustSee)).not.toContain("Karnak Temple Complex");
    // The day check then holds day 2 to it.
    const day2 = day(["Hanging Church", "see"], ["Lunch", "meal"], ["Old Cairo walk", "do"]);
    expect(checkDay(day2, { mustSee: days[1]!.mustSee }).map((i) => i.code)).toEqual(["must_see"]);
  });

  it("leaves the outline alone when it already has them", () => {
    const already = outlineDays();
    already[0]!.mustSee.push("Giza Pyramid Complex");
    expect(ensureLandmarks(already, egypt, { days: 2 }).added).toEqual([]);
  });

  it("uses the day the outline gave the sight, unless that's an arrival day with another day near", () => {
    const given = outlineDays();
    given[0]!.candidateIds.push("gp_pyr");
    expect(ensureLandmarks(given, egypt, { days: 2 }).days[0]!.mustSee).toContain("Pyramids of Giza");
    const moved = ensureLandmarks(outlineDays().map((d, i) => (i === 0 ? { ...d, candidateIds: [...d.candidateIds, "gp_pyr"] } : d)), egypt, { days: 2, avoid: [0] });
    expect(moved.days[1]!.mustSee).toContain("Pyramids of Giza");
    expect(moved.days[0]!.candidateIds).not.toContain("gp_pyr");
  });

  it("does nothing where nothing is famous enough, or nothing can be placed", () => {
    expect(ensureLandmarks(outlineDays(), egypt.filter((c) => (c.ratingCount ?? 0) < 20_000), { days: 3 }).added).toEqual([]);
    expect(ensureLandmarks([{ candidateIds: ["lp_kosh"] }], egypt, { days: 1 }).added).toEqual([]);
  });

  it("knows a returning traveler from their history", () => {
    const trip = (city: string): PastTrip => ({ id: city, city, countryCode: "EG", year: 2019, month: 3, days: 4, rating: 5, highlights: "", tripId: null });
    expect(isReturnVisit(historyForPrompt([trip("Cairo")], "Cairo", () => "Egypt"))).toBe(true);
    expect(isReturnVisit(historyForPrompt([trip("Alexandria")], "Cairo", () => "Egypt"))).toBe(false);
    expect(isReturnVisit("")).toBe(false);
  });
});
