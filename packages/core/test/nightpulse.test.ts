import { describe, expect, it } from "vitest";
import {
  NightSpotsSchema,
  TripRequestSchema,
  blendWeights,
  buildNightPulsePrompt,
  buildPulse,
  checkEvidence,
  defaultWeights,
  hotNow,
  hotScore,
  parsePageAge,
  pulseCandidates,
  recency,
  scoreCandidate,
  urlKey,
  type NightEvidence,
  type NightSpot,
  type PlaceVerification,
} from "../src";

const NOW = new Date("2026-11-07T12:00:00Z");
const ev = (url: string, date: string | null, source = ""): NightEvidence => ({ url, date, source });
const spot = (name: string, evidence: NightEvidence[], more: Partial<NightSpot> = {}): NightSpot =>
  NightSpotsSchema.parse({ spots: [{ name, neighborhood: "Kreuzberg", type: "club", style: "techno club", when: "Fri–Sun", door: "strict door", why: "", closed: false, evidence, ...more }] }).spots[0]!;

describe("checking the sources", () => {
  it("matches a cited page to a search result by host and path", () => {
    expect(urlKey("https://www.timeout.com/berlin/bars/best-bars-in-berlin/")).toBe("timeout.com/berlin/bars/best-bars-in-berlin");
    expect(urlKey("https://ra.co/clubs/5031?utm_source=x#top")).toBe("ra.co/clubs/5031");
    expect(urlKey("javascript:alert(1)")).toBeNull();
  });

  it("reads the search's page ages", () => {
    expect(parsePageAge("March 3, 2026", NOW)).toBe("2026-03-03");
    expect(parsePageAge("2026-03", NOW)).toBe("2026-03-15");
    expect(parsePageAge("2 weeks ago", NOW)).toBe("2026-10-24");
    expect(parsePageAge("a year ago", NOW)).toBe("2025-11-07");
    expect(parsePageAge("someday", NOW)).toBeNull();
    expect(parsePageAge("March 3, 2031", NOW)).toBeNull();
  });

  it("drops what the search never returned, fills dates from page ages, and drops closed places", () => {
    const results = [
      { url: "https://ra.co/clubs/5031", pageAge: "2 months ago" },
      { url: "https://www.timeout.com/berlin/clubs/best-clubs", pageAge: "October 1, 2026" },
    ];
    const spots = [
      spot("Berghain", [ev("https://ra.co/clubs/5031/", null, "RA"), ev("https://made-up.example/best-clubs", "2026-10-01")]),
      spot("Invented Club", [ev("https://made-up.example/invented", "2026-10-01")]),
      spot("Closed Club", [ev("https://www.timeout.com/berlin/clubs/best-clubs", "2026-10-01")], { closed: true }),
    ];
    const checked = checkEvidence(spots, results, NOW);
    expect(checked.map((s) => s.name)).toEqual(["Berghain"]);
    expect(checked[0]!.evidence).toEqual([{ source: "RA", url: "https://ra.co/clubs/5031", date: "2026-09-07" }]);
  });
});

describe("how hot a place is now", () => {
  it("halves a mention's weight every year", () => {
    expect(recency("2026-11-07", NOW)).toBeCloseTo(1, 2);
    expect(recency("2025-11-07", NOW)).toBeCloseTo(0.5, 1);
    expect(recency("2023-11-07", NOW)).toBeCloseTo(0.125, 1);
  });

  it("a club that was hot three years ago isn't hot now; a new one with fresh coverage is", () => {
    const faded = [ev("https://ra.co/clubs/1", "2023-09-01"), ev("https://mixmag.net/feature/1", "2023-10-01"), ev("https://www.timeout.com/x", "2023-11-01")];
    const rising = [ev("https://ra.co/clubs/2", "2026-09-01"), ev("https://www.reddit.com/r/berlin/comments/x", "2026-10-01")];
    expect(hotScore(faded, NOW)).toBeLessThan(0.4);
    expect(hotNow(faded, NOW)).toBeNull();
    expect(hotScore(rising, NOW)).toBeGreaterThan(1);
    expect(hotNow(rising, NOW)!.sources.map((s) => s.name)).toEqual(["Resident Advisor", "Reddit"]);
  });

  it("counts a site once, however many of its pages mention the place", () => {
    const one = [ev("https://www.timeout.com/a", "2026-10-01"), ev("https://www.timeout.com/b", "2026-09-01"), ev("https://www.timeout.com/c", "2026-08-01")];
    expect(hotScore(one, NOW)).toBeLessThan(1);
    expect(hotNow(one, NOW)).toBeNull();
  });

  it("weighs nightlife specialists over listings sites", () => {
    expect(hotScore([ev("https://ra.co/clubs/1", "2026-10-01")], NOW)).toBeGreaterThan(hotScore([ev("https://www.tripadvisor.com/x", "2026-10-01")], NOW) * 3);
  });

  it("needs one source from the last six months to be hot right now", () => {
    const lastYear = [ev("https://ra.co/clubs/1", "2026-02-01"), ev("https://mixmag.net/a", "2026-03-01"), ev("https://www.timeout.com/a", "2026-04-01")];
    expect(hotScore(lastYear, NOW)).toBeGreaterThan(1);
    expect(hotNow(lastYear, NOW)).toBeNull();
  });
});

const place = (id: string, lat: number, lng: number, status = "OPERATIONAL"): PlaceVerification => ({ placeId: id, lat, lng, status, mapsUrl: `https://maps.google.com/?cid=${id}` });

describe("a city's pulse", () => {
  const fresh = [ev("https://ra.co/clubs/2", "2026-09-01"), ev("https://www.reddit.com/r/berlin/comments/x", "2026-10-01")];
  const spots = [
    { ...spot("Berghain", fresh), place: place("p1", 52.511, 13.443) },
    { ...spot("Bar Tausend", [ev("https://www.timeout.com/berlin/bars", "2026-06-01")], { type: "bar", style: "cocktail bar" }), place: place("p2", 52.52, 13.39) },
    { ...spot("Closed Now", fresh), place: place("p3", 52.5, 13.4, "CLOSED_PERMANENTLY") },
    { ...spot("Far Away Club", fresh), place: place("p4", 48.13, 11.58) },
    spot("Not On Google", fresh),
  ];

  it("keeps when each place first appeared, and last month's list as history", () => {
    const first = buildPulse("Berlin", spots.slice(0, 2), null, new Date("2026-10-01T00:00:00Z"));
    expect(first.spots.map((s) => s.name)).toEqual(["Berghain", "Bar Tausend"]);
    const next = buildPulse("Berlin", [spots[0]!], first, NOW);
    expect(next.spots[0]!.firstSeen).toBe("2026-10-01");
    expect(next.history[0]!.spots.map((s) => s.name)).toEqual(["Berghain", "Bar Tausend"]);
  });

  it("becomes candidates: open places Google found, near the trip, hot ones tagged", () => {
    const pulse = buildPulse("Berlin", spots, null, NOW);
    const cands = pulseCandidates(pulse, { near: [{ lat: 52.52, lng: 13.405 }], now: NOW });
    expect(cands.map((c) => c.name)).toEqual(["Berghain", "Bar Tausend"]);
    const [club, bar] = cands;
    expect(club).toMatchObject({ id: "gp_p1", category: "nightlife", source: "locals" });
    expect(club!.tags).toEqual(["night_club", "night_pulse", "hot_now"]);
    expect(club!.hot!.sources[0]!.name).toBe("Resident Advisor");
    expect(club!.note).toMatch(/^Hot right now\. techno club\. Fri–Sun\. strict door/);
    expect(bar).toMatchObject({ category: "drink", source: "press" });
    expect(bar!.hot).toBeUndefined();
  });

  it("puts hot places ahead in the planner's ranking", () => {
    const pulse = buildPulse("Berlin", spots, null, NOW);
    const cands = pulseCandidates(pulse, { now: NOW });
    const club = cands.find((c) => c.name === "Berghain");
    const bar = cands.find((c) => c.name === "Bar Tausend");
    const r = TripRequestSchema.parse({ destination: "Berlin", days: 3, party: "Couple", budget: "Mid-range", pace: "Balanced", interests: ["Nightlife"], clubs: true });
    const eff = blendWeights({ weights: defaultWeights(), blocked: [] }, { useCustom: false, weights: {}, blocked: [] });
    expect(scoreCandidate(club!, eff, r)).toBeGreaterThan(scoreCandidate({ ...club!, hot: undefined, tags: ["night_club"] }, eff, r));
    expect(scoreCandidate(bar!, eff, r)).toBeGreaterThan(scoreCandidate({ ...bar!, tags: ["bar"] }, eff, r));
  });

  it("asks for recent, dated, real sources", () => {
    const p = buildNightPulsePrompt("Berlin", NOW);
    expect(p).toMatch(/Today is 2026-11-07/);
    expect(p).toMatch(/last 12 months/);
    expect(p).toMatch(/Never write a URL you did not see in a search result/);
    expect(p).toMatch(/best clubs Berlin 2026/);
  });
});
