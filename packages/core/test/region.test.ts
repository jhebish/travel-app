import { describe, expect, it } from "vitest";
import {
  BLOCKED_REDIRECT,
  JERUSALEM_RULES,
  TripRequestSchema,
  blendWeights,
  buildRoutePrompt,
  defaultWeights,
  inEastJerusalem,
  placesQueries,
  regionPolicy,
  travelerBlock,
} from "../src";

describe("where trips are planned", () => {
  it("doesn't plan trips in Israel", () => {
    for (const d of ["Israel", "Tel Aviv", "Tel Aviv-Yafo", "Haifa, Israel", "Eilat", "Nazareth", "Jaffa", "Sea of Galilee", "Tel Aviv and Jerusalem", "Israel and Jordan", "Dead Sea", "תל אביב", "حيفا"]) {
      expect(regionPolicy(d), d).toBe("blocked");
    }
    expect(BLOCKED_REDIRECT).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=jF6N2OKo8rk/);
  });

  it("plans Jerusalem, with its own rules", () => {
    for (const d of ["Jerusalem", "Jerusalem, Israel", "East Jerusalem", "Al-Quds", "القدس", "ירושלים", "Jaffa Gate, Jerusalem"]) {
      expect(regionPolicy(d), d).toBe("jerusalem");
    }
  });

  it("plans the West Bank and everywhere else", () => {
    for (const d of ["Bethlehem", "Ramallah, Palestine", "West Bank", "Palestine", "Hebron", "Jericho", "Israel and Palestine", "Dead Sea, Jordan", "Amman", "Lisbon"]) {
      expect(regionPolicy(d), d).toBe("ok");
    }
  });

  it("knows a same-named place elsewhere", () => {
    for (const d of ["Nazareth, Pennsylvania", "Jerusalem, Ohio", "Acre, Brazil", "Arad, Romania", "Bethlehem, USA"]) {
      expect(regionPolicy(d), d).toBe("ok");
    }
  });
});

const req = (r: Record<string, unknown>) => TripRequestSchema.parse({ days: 3, party: "Couple", budget: "Mid-range", pace: "Balanced", ...r });

describe("Jerusalem trips", () => {
  it("search for Palestinian businesses in East Jerusalem and the Old City", () => {
    const qs = placesQueries(req({ destination: "Jerusalem", stay: { on: true, styles: ["Boutique"], price: "$150–300" } })).map((q) => q.query);
    expect(qs).toContain("Palestinian restaurants in East Jerusalem");
    expect(qs).toContain("Palestinian-owned hotels in East Jerusalem");
    expect(qs.every((q) => /East Jerusalem|Old City of Jerusalem/.test(q))).toBe(true);
  });

  it("tell every prompt the rules", () => {
    expect(travelerBlock(req({ destination: "Jerusalem" }))).toContain(JERUSALEM_RULES);
    expect(travelerBlock(req({ destination: "Bethlehem" }))).not.toContain("JERUSALEM");
    expect(JERUSALEM_RULES).toMatch(/Only Palestinian-owned and Palestinian-run businesses/);
  });

  it("keep places Google finds to East Jerusalem and the Old City", () => {
    expect(inEastJerusalem({ verification: { lng: 35.2306 } })).toBe(true); // Damascus Gate
    expect(inEastJerusalem({ verification: { lng: 35.2276 } })).toBe(true); // Jaffa Gate
    expect(inEastJerusalem({ verification: { lng: 35.2245 } })).toBe(false); // Mamilla
    expect(inEastJerusalem({ verification: { lng: 35.2121 } })).toBe(false); // Mahane Yehuda
    expect(inEastJerusalem({})).toBe(true);
  });
});

describe("routes in the region", () => {
  const eff = blendWeights({ weights: defaultWeights(), blocked: [] }, { useCustom: false, weights: {}, blocked: [] });
  const lists = { alwaysFeature: "", neverRecommend: "" };
  it("are told to leave out Israel", () => {
    expect(buildRoutePrompt(req({ mode: "multi", destination: "Jordan", days: 7 }), eff, lists)).toMatch(/No stops or alternatives in Israel/);
    expect(buildRoutePrompt(req({ mode: "multi", destination: "Italy", days: 7 }), eff, lists)).not.toMatch(/Israel/);
  });
});
