import { describe, expect, it } from "vitest";
import {
  TripRequestSchema,
  DaySchema,
  ItinerarySchema,
  OutlineSchema,
  HotelSchema,
  aggregateInsights,
  blendWeights,
  buildFeedback,
  buildTripPrompt,
  defaultWeights,
  hasSignal,
  scoreCandidate,
  selectCandidates,
  type Candidate,
  type Itinerary,
} from "../src";

const req = TripRequestSchema.parse({
  destination: "Lisbon",
  days: 2,
  party: "Couple",
  age: "25–34",
  about: ["Eats halal", "LGBTQ+ traveler"],
  budget: "Mid-range",
  interests: ["Food", "Live music"],
  pace: "Balanced",
  extra: "anniversary",
  stay: { on: true, styles: ["Boutique"], price: "$150–300" },
});

const app = { weights: defaultWeights(), blocked: ["sponsored" as const] };

describe("blendWeights", () => {
  it("uses app defaults when the traveler has no custom mix", () => {
    const eff = blendWeights(app, { useCustom: false, weights: { reviews: 10 }, blocked: [] });
    expect(eff.custom).toBe(false);
    expect(eff.weights.reviews).toBe(3);
  });
  it("applies the traveler's weights and extra blocks", () => {
    const eff = blendWeights(app, { useCustom: true, weights: { reviews: 10 }, blocked: ["social"] });
    expect(eff.weights.reviews).toBe(10);
    expect(eff.weights.social).toBe(0);
    expect(eff.blocked).toContain("social");
  });
  it("never lets a traveler unblock an app-blocked source", () => {
    const eff = blendWeights(app, { useCustom: true, weights: { sponsored: 10 }, blocked: [] });
    expect(eff.weights.sponsored).toBe(0);
    expect(eff.blocked).toContain("sponsored");
  });
  it("clamps bad values", () => {
    const eff = blendWeights({ weights: { locals: 99 as number }, blocked: [] });
    expect(eff.weights.locals).toBe(10);
  });
});

describe("candidate scoring", () => {
  const eff = blendWeights(app);
  const base: Candidate = { id: "x", origin: "google", name: "X", category: "food", source: "reviews" };
  it("excludes blocked sources", () => {
    expect(scoreCandidate({ ...base, source: "sponsored" }, eff, req)).toBe(Number.NEGATIVE_INFINITY);
  });
  it("ranks a local pick above a review-site result", () => {
    const local = scoreCandidate({ ...base, origin: "local_pick", source: "locals" }, eff, req);
    const google = scoreCandidate({ ...base, rating: 4.8 }, eff, req);
    expect(local).toBeGreaterThan(google);
  });
  it("prefers halal-tagged food for halal travelers", () => {
    const halal = scoreCandidate({ ...base, tags: ["halal"] }, eff, req);
    const plain = scoreCandidate(base, eff, req);
    expect(halal).toBeGreaterThan(plain);
  });
  it("dedupes and splits activities and stays", () => {
    const list: Candidate[] = [
      { ...base, id: "a", placeId: "p1" },
      { ...base, id: "b", placeId: "p1" },
      { ...base, id: "c", category: "stay", source: "hosts", stayStyle: "Boutique", priceBand: "$150–300" },
    ];
    const out = selectCandidates(list, eff, req);
    expect(out.map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("prompt", () => {
  it("includes candidates, source weights and hotel rules", () => {
    const eff = blendWeights(app);
    const p = buildTripPrompt(req, eff, { alwaysFeature: "Tasca do Chico", neverRecommend: "" }, [
      { id: "lp_1", origin: "local_pick", name: "Zé dos Cornos", category: "food", source: "locals" },
    ]);
    expect(p).toContain("[lp_1] Zé dos Cornos");
    expect(p).toContain('"locals" · Local residents · weight 10');
    expect(p).toContain("HOTELS");
    expect(p).toContain("Tasca do Chico");
    expect(p).not.toContain('"sponsored" ·');
  });
});

const itinerary: Itinerary = {
  title: "T",
  summary: "S",
  days: [
    {
      label: "Day 1",
      theme: "A",
      stops: [
        { time: "09:00", name: "A", neighborhood: "", why: "", localTip: "", source: "locals" },
        { time: "11:00", name: "B", neighborhood: "", why: "", localTip: "", source: "reviews" },
      ],
    },
  ],
  hotels: [{ name: "H", neighborhood: "", style: "Boutique", nightly: "$200", why: "", localTip: "", source: "hosts" }],
  notes: [],
  replaced: [],
};

describe("feedback", () => {
  const trip = { request: req, itinerary, weights: defaultWeights(), custom_mix: false, saved: true, rating: 4, votes: { "0-0": 1, "0-1": -1, "h-0": 1 } as const };
  it("strips personal details", () => {
    const fb = buildFeedback({ ...trip, votes: { ...trip.votes } });
    const json = JSON.stringify(fb);
    expect(json).not.toContain("halal");
    expect(json).not.toContain("LGBTQ");
    expect(json).not.toContain("anniversary");
  });
  it("counts votes per source and hotel style", () => {
    const fb = buildFeedback({ ...trip, votes: { ...trip.votes } });
    expect(fb.source_votes.locals).toEqual({ up: 1, down: 0 });
    expect(fb.source_votes.reviews).toEqual({ up: 0, down: 1 });
    expect(fb.hotel_votes).toEqual([{ style: "Boutique", vote: 1 }]);
    expect(fb.shares.locals).toBeCloseTo(1 / 3, 2);
  });
  it("detects signal", () => {
    expect(hasSignal({ saved: false, rating: 0, votes: {} })).toBe(false);
    expect(hasSignal({ saved: false, rating: 0, votes: { "0-0": 1 } })).toBe(true);
  });
  it("suggests weights only with enough votes", () => {
    const row = buildFeedback({ ...trip, votes: { ...trip.votes } });
    const few = aggregateInsights([row], defaultWeights(), ["sponsored"]);
    expect(few.sources.find((s) => s.id === "locals")!.suggested).toBeNull();
    const many = aggregateInsights(Array(6).fill(row), defaultWeights(), ["sponsored"]);
    const locals = many.sources.find((s) => s.id === "locals")!;
    const reviews = many.sources.find((s) => s.id === "reviews")!;
    expect(locals.suggested).toBe(10);
    expect(reviews.suggested).toBeLessThan(3);
    expect(many.hotelStyles[0]).toEqual({ style: "Boutique", rated: 6, upRate: 1 });
  });
});

import { buildDayPrompt, buildIcs, buildSwapPrompt, googleMapsDayUrl, legBetween } from "../src";

describe("editing prompts", () => {
  const eff = blendWeights(app);
  const it2: Itinerary = JSON.parse(JSON.stringify(itinerary));
  it2.days[0]!.stops[1]!.locked = true;
  it("swap excludes places already in the trip", () => {
    const p = buildSwapPrompt(req, eff, { alwaysFeature: "", neverRecommend: "" }, it2, 0, 0, "cheaper", []);
    expect(p).toContain('Replace stop 1 ("A"');
    expect(p).toContain('"cheaper"');
    expect(p).toMatch(/Do not suggest A or any place already in the trip: A, B, H/);
  });
  it("day rebuild keeps locked stops", () => {
    const p = buildDayPrompt(req, eff, { alwaysFeature: "", neverRecommend: "" }, it2, 0, "", []);
    expect(p).toContain("Keep these LOCKED stops exactly");
    expect(p).toContain("11:00 B");
  });
});

describe("maps and calendar", () => {
  const a = { time: "09:00", name: "A", neighborhood: "Alfama", why: "", localTip: "", source: "locals" as const, lat: 38.711, lng: -9.13 };
  const b = { ...a, name: "B", lat: 38.713, lng: -9.135 };
  const far = { ...a, name: "C", lat: 38.75, lng: -9.2 };
  it("estimates walks and rides", () => {
    const walk = legBetween(a, b)!;
    expect(walk.mode).toBe("walk");
    expect(walk.approximate).toBe(true);
    expect(walk.minutes).toBeGreaterThan(2);
    expect(legBetween(a, far)!.mode).toBe("ride");
    expect(legBetween({ ...a, lat: null, lng: null }, b)).toBeNull();
  });
  it("builds a Google Maps directions link", () => {
    const url = googleMapsDayUrl([a, b, far], "Lisbon");
    expect(url).toContain("https://www.google.com/maps/dir/?api=1");
    const q = new URL(url).searchParams;
    expect(q.get("origin")).toBe("A, Alfama, Lisbon");
    expect(q.get("waypoints")).toBe("B, Alfama, Lisbon");
    expect(q.get("destination")).toBe("C, Alfama, Lisbon");
  });
  it("builds a valid calendar", () => {
    const ics = buildIcs(itinerary, "Lisbon", "2026-12-01");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics.match(/BEGIN:VEVENT/g)!.length).toBe(2);
    expect(ics).toContain("DTSTART:20261201T090000");
    expect(ics).toContain("DTEND:20261201T110000");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});

describe("replaced votes", () => {
  it("count toward source feedback", () => {
    const fb = buildFeedback({
      request: req,
      itinerary: { ...itinerary, replaced: [{ source: "social", vote: -1 }] },
      weights: defaultWeights(),
      custom_mix: false,
      saved: false,
      rating: 0,
      votes: {},
    });
    expect(fb.source_votes.social).toEqual({ up: 0, down: 1 });
  });
});

import { ItinerarySchema as ItinSchema2, normalizeModelOutput } from "../src";

describe("normalizeModelOutput", () => {
  it("unwraps JSON-encoded lists and drops nulls so validation passes", () => {
    const raw = {
      title: "T",
      summary: "S",
      days: JSON.stringify([{ label: "Day 1", theme: "A", stops: JSON.stringify([{ time: "09:00", name: "X", neighborhood: null, why: "w", localTip: null, source: "locals", candidateId: null }]) }]),
      hotels: "[]",
      notes: '["Bring shoes"]',
    };
    const out = normalizeModelOutput(raw) as Record<string, unknown>;
    const parsed = ItinSchema2.safeParse(out);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.days[0]!.stops[0]!.neighborhood).toBe("");
      expect(parsed.data.notes).toEqual(["Bring shoes"]);
    }
  });
  it("leaves ordinary strings alone", () => {
    expect(normalizeModelOutput({ why: "[sic] a great spot" })).toEqual({ why: "[sic] a great spot" });
  });
});

describe("tolerant plan validation", () => {
  const good = { time: "09:30", name: "Manteigaria", neighborhood: "Chiado", why: "Nata.", localTip: "", source: "locals", candidateId: null };
  it("keeps a day when one stop is malformed", () => {
    const r = DaySchema.safeParse({ label: "Day 1", theme: "x", stops: [good, { why: "no name" }, { ...good, name: "Ribeira" }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stops.map((s) => s.name)).toEqual(["Manteigaria", "Ribeira"]);
  });
  it("maps loose source labels and coerces ids, times and coordinates", () => {
    const r = DaySchema.parse({
      label: "Day 1",
      theme: "x",
      stops: [{ name: "A", source: "Local friends", candidateId: 12, lat: "38.71", lng: -9.1 }, { name: "B", source: "Lonely Planet" }, { name: "C", source: "???" }],
    });
    expect(r.stops.map((s) => s.source)).toEqual(["locals", "guidebooks", "guidebooks"]);
    expect(r.stops[0]!.candidateId).toBe("12");
    expect(r.stops[0]!.lat).toBeCloseTo(38.71);
    expect(r.stops[0]!.time).toBe("");
  });
  it("still rejects a day with no usable stops", () => {
    expect(DaySchema.safeParse({ label: "Day 1", theme: "x", stops: [{ why: "?" }] }).success).toBe(false);
  });
  it("accepts an outline with numeric candidate ids and no summary", () => {
    const r = OutlineSchema.safeParse({ title: "T", days: [{ label: "Day 1", theme: "t", candidateIds: [3, "c4"] }] });
    expect(r.success).toBe(true);
  });
  it("accepts a hotel with a bracketed candidate id", () => {
    expect(HotelSchema.parse({ name: "Memmo", source: "press", candidateId: "[c7]" }).candidateId).toBe("c7");
  });
});

describe("typeform intake", () => {
  it("defines unique refs for every field and choice", async () => {
    const { typeformDefinition } = await import("../src/typeform");
    const def = typeformDefinition();
    const refs = def.fields.map((f) => f.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const f of def.fields) {
      const cs = (f as { properties?: { choices?: { ref: string }[] } }).properties?.choices ?? [];
      expect(new Set(cs.map((c) => c.ref)).size).toBe(cs.length);
      for (const c of cs) expect(c.ref).toMatch(/^[a-z0-9_]+$/);
    }
  });
  it("maps a full response by refs", async () => {
    const { typeformToRequest } = await import("../src/typeform");
    const r = typeformToRequest([
      { field: { ref: "destination" }, type: "text", text: " Lisbon " },
      { field: { ref: "days" }, type: "number", number: 9 },
      { field: { ref: "start_date" }, type: "date", date: "2026-12-01T00:00:00Z" },
      { field: { ref: "party" }, type: "choice", choice: { ref: "party_solo", label: "Just me" } },
      { field: { ref: "budget" }, type: "choice", choice: { ref: "budget_splurge", label: "Splurge ($$$)" } },
      { field: { ref: "interests" }, type: "choices", choices: { refs: ["interests_food", "interests_live_music"], labels: ["Food", "Live music"] } },
      { field: { ref: "about" }, type: "choices", choices: { refs: ["about_eats_halal"], labels: ["Eats halal"] } },
      { field: { ref: "stay_on" }, type: "boolean", boolean: true },
      { field: { ref: "stay_price" }, type: "choice", choice: { ref: "stay_price_300_600", label: "$300–600" } },
      { field: { ref: "stay_styles" }, type: "choices", choices: { refs: ["stay_styles_boutique"], labels: ["Boutique"] } },
    ]);
    expect(r).toMatchObject({
      destination: "Lisbon",
      days: 7,
      startDate: "2026-12-01",
      party: "Solo",
      budget: "Splurge",
      interests: ["Food", "Live music"],
      about: ["Eats halal"],
      stay: { on: true, styles: ["Boutique"], price: "$300–600" },
    });
  });
  it("falls back to labels when choices were added by hand, and defaults the rest", async () => {
    const { typeformToRequest } = await import("../src/typeform");
    const r = typeformToRequest([
      { field: { ref: "destination" }, type: "text", text: "Oaxaca" },
      { field: { ref: "party" }, type: "choice", choice: { label: "As a couple" } },
      { field: { ref: "budget" }, type: "choice", choice: { label: "Keep it cheap ($)" } },
      { field: { ref: "pace" }, type: "choice", choice: { label: "Packed: see as much as we can" } },
      { field: { ref: "stay_on" }, type: "boolean", boolean: false },
    ]);
    expect(r).toMatchObject({ destination: "Oaxaca", days: 3, party: "Couple", budget: "Budget", pace: "Packed", stay: { on: false } });
  });
  it("rejects a response with no destination", async () => {
    const { typeformToRequest } = await import("../src/typeform");
    expect(() => typeformToRequest([{ field: { ref: "days" }, type: "number", number: 2 }])).toThrow(/destination/);
  });
});

describe("community", () => {
  it("groups destinations by city", async () => {
    const { cityKey } = await import("../src/community");
    expect(cityKey("Lisbon, Portugal")).toBe("lisbon");
    expect(cityKey("  São Paulo ")).toBe("sao paulo");
    expect(cityKey("MEXICO CITY")).toBe("mexico city");
  });
  it("counts distinct countries and cities and picks a level", async () => {
    const { travelStats } = await import("../src/community");
    const s = travelStats([
      { city: "Lisbon", countryCode: "PT" },
      { city: "lisbon", countryCode: "PT" },
      { city: "Porto", countryCode: "PT" },
      { city: "Kyoto", countryCode: "JP" },
      { city: "Oaxaca", countryCode: "mx" },
    ]);
    expect(s).toMatchObject({ countries: 3, cities: 4, trips: 5 });
    expect(s.level.name).toBe("Explorer");
    expect(s.next).toMatchObject({ countriesToGo: 5 });
  });
  it("ranks travellers by countries, then cities, with ties sharing a rank", async () => {
    const { rankTravellers } = await import("../src/community");
    const r = rankTravellers([
      { id: "a", stats: { countries: 3, cities: 5, trips: 6 } },
      { id: "b", stats: { countries: 7, cities: 9, trips: 9 } },
      { id: "c", stats: { countries: 3, cities: 5, trips: 6 } },
      { id: "d", stats: { countries: 3, cities: 8, trips: 8 } },
    ]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([["b", 1], ["d", 2], ["a", 3], ["c", 3]]);
  });
  it("validates places and profiles", async () => {
    const { PastTripInputSchema, CommunityProfileInputSchema } = await import("../src/community");
    expect(PastTripInputSchema.safeParse({ city: "Kyoto", countryCode: "jp" }).success).toBe(true);
    expect(PastTripInputSchema.safeParse({ city: "Kyoto", countryCode: "ZZ" }).success).toBe(false);
    expect(PastTripInputSchema.safeParse({ city: "Kyoto", countryCode: "JP", year: 3000 }).success).toBe(false);
    expect(CommunityProfileInputSchema.safeParse({ handle: "James_H", displayName: "James" }).success).toBe(true);
    expect(CommunityProfileInputSchema.safeParse({ handle: "admin", displayName: "x" }).success).toBe(false);
    expect(CommunityProfileInputSchema.safeParse({ handle: "a b", displayName: "x" }).success).toBe(false);
  });
  it("writes a history block that flags a repeat visit", async () => {
    const { historyForPrompt } = await import("../src/community");
    const { countryName } = await import("../src/countries");
    const h = historyForPrompt(
      [
        { id: "1", city: "Lisbon", countryCode: "PT", year: 2024, month: null, days: 4, rating: 5, highlights: "tascas and fado", tripId: null },
        { id: "2", city: "Paris", countryCode: "FR", year: 2023, month: null, days: 3, rating: 2, highlights: "", tripId: null },
      ],
      "Lisbon, Portugal",
      countryName,
    );
    expect(h).toContain("Lisbon, Portugal (2024), rated 5/5: loved tascas and fado");
    expect(h).toContain("been to Lisbon before");
    expect(historyForPrompt([], "Lisbon", countryName)).toBe("");
  });
  it("strips planner internals from shared itineraries", async () => {
    const { publicItinerary } = await import("../src/community");
    const it = publicItinerary({
      title: "T",
      summary: "",
      notes: [],
      replaced: [{ source: "locals", vote: 1 }],
      days: [{ label: "Day 1", theme: "", stops: [{ time: "", name: "A", neighborhood: "", why: "", localTip: "", source: "locals", candidateId: "c1", locked: true }] }],
      hotels: [{ name: "H", neighborhood: "", style: "", nightly: "", why: "", localTip: "", source: "press", candidateId: "c2", expediaPropertyId: "9" }],
    });
    expect(it.replaced).toEqual([]);
    expect(it.days[0]!.stops[0]).not.toHaveProperty("candidateId");
    expect(it.days[0]!.stops[0]).not.toHaveProperty("locked");
    expect(it.hotels[0]).not.toHaveProperty("expediaPropertyId");
  });
  it("has unique country codes", async () => {
    const { COUNTRIES, flag } = await import("../src/countries");
    expect(new Set(COUNTRIES.map((c) => c[0])).size).toBe(COUNTRIES.length);
    expect(flag("JP")).toBe("🇯🇵");
  });
});

describe("model output repair", () => {
  it("parses stops sent as a JSON string with raw newlines and trailing commas", async () => {
    const { normalizeModelOutput } = await import("../src/normalize");
    const raw = { theme: "x", stops: '[{"time":"09:00","name":"Bakery\nCorner","source":"locals",},]' };
    const out = normalizeModelOutput(raw) as { stops: { name: string }[] };
    expect(Array.isArray(out.stops)).toBe(true);
    expect(out.stops[0]!.name).toBe("Bakery\nCorner");
  });
  it("keeps the complete items of a cut-off list", async () => {
    const { parseLooseJson } = await import("../src/normalize");
    const v = parseLooseJson('[{"name":"A","why":"one"},{"name":"B","why":"two"},{"name":"C","wh') as { name: string }[];
    expect(v.map((x) => x.name)).toEqual(["A", "B"]);
  });
  it("leaves bracketed prose alone", async () => {
    const { parseLooseJson } = await import("../src/normalize");
    expect(parseLooseJson("[sic] a great spot")).toBeUndefined();
  });
  it("validates a day whose stops came back as a string", async () => {
    const { normalizeModelOutput } = await import("../src/normalize");
    const day = normalizeModelOutput({ theme: "t", stops: JSON.stringify([{ time: "09:00", name: "A", source: "locals" }]) });
    expect(DaySchema.safeParse({ label: "Day 1", ...(day as object) }).success).toBe(true);
  });
});

describe("multi-city", () => {
  it("defaults to one place and clamps days per mode", () => {
    expect(TripRequestSchema.parse({ destination: "Lisbon", days: 12, party: "Solo", budget: "Budget", pace: "Slow" })).toMatchObject({ mode: "single", days: 7 });
    expect(TripRequestSchema.parse({ mode: "multi", destination: "Egypt", days: 12, party: "Solo", budget: "Budget", pace: "Slow" })).toMatchObject({ mode: "multi", days: 12 });
    expect(TripRequestSchema.parse({ mode: "multi", destination: "Egypt", days: 14, party: "Solo", budget: "Budget", pace: "Slow" }).days).toBe(14);
  });
  it("fits a route to the trip length and fills day themes", async () => {
    const { fitRoute } = await import("../src/route");
    const legs = [
      { city: "Cairo", region: "", days: 4, why: "", transfer: null, dayThemes: [{ theme: "Old Cairo", area: "Islamic Cairo" }] },
      { city: "Luxor", region: "", days: 3, why: "", transfer: { mode: "train", duration: "10h", note: "" }, dayThemes: [] },
      { city: "Aswan", region: "", days: 3, why: "", transfer: { mode: "train", duration: "3h", note: "" }, dayThemes: [] },
    ];
    const fitted = fitRoute(legs, 7);
    expect(fitted.reduce((n, l) => n + l.days, 0)).toBe(7);
    expect(fitted.every((l) => l.dayThemes.length === l.days)).toBe(true);
    expect(fitted[0]!.transfer).toBeNull();
    const longer = fitRoute(legs, 12);
    expect(longer.reduce((n, l) => n + l.days, 0)).toBe(12);
    const tooMany = fitRoute(legs, 2);
    expect(tooMany.length).toBe(2);
    expect(tooMany.reduce((n, l) => n + l.days, 0)).toBe(2);
  });
  it("accepts an itinerary with a route and per-day cities", () => {
    const r = ItinerarySchema.safeParse({
      title: "Egypt",
      mode: "multi",
      route: [{ city: "Cairo", days: "3", why: "x", transfer: null }],
      days: [{ label: "Day 1", theme: "t", city: "Cairo", stops: [{ name: "Khan el-Khalili", source: "locals" }] }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.route?.[0]!.days).toBe(3);
  });
});

describe("browse destinations", () => {
  it("has unique keys, valid coordinates and sample requests that validate", async () => {
    const { DESTINATIONS, sampleRequest } = await import("../src/destinations");
    expect(new Set(DESTINATIONS.map((d) => d.key)).size).toBe(DESTINATIONS.length);
    for (const d of DESTINATIONS) {
      expect(Math.abs(d.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(d.lng)).toBeLessThanOrEqual(180);
      expect(d.bestMonths.every((m) => m >= 1 && m <= 12)).toBe(true);
      const req = TripRequestSchema.parse(sampleRequest(d));
      expect(req.mode).toBe(d.kind === "region" ? "multi" : "single");
      expect(req.days).toBe(d.sampleDays);
    }
  });
  it("summarizes best months, wrapping round the new year", async () => {
    const { monthsLabel } = await import("../src/destinations");
    expect(monthsLabel([3, 4, 5, 10, 11])).toBe("Mar–May, Oct–Nov");
    expect(monthsLabel([11, 12, 1, 2, 3])).toBe("Nov–Mar");
    expect(monthsLabel([6])).toBe("Jun");
  });
  it("ranks in-season, trend-listed places higher", async () => {
    const { DESTINATION_BY_KEY, trendScore } = await import("../src/destinations");
    const kyoto = DESTINATION_BY_KEY["kyoto"]!;
    expect(trendScore(kyoto, 11)).toBeGreaterThan(trendScore(kyoto, 7));
  });
});

describe("typeform trip type", () => {
  it("maps several stops to a multi-city request and spots 'not sure yet'", async () => {
    const { typeformToRequest, typeformWantsBrowse, typeformDefinition } = await import("../src/typeform");
    const r = typeformToRequest([
      { field: { ref: "trip_type" }, type: "choice", choice: { ref: "trip_type_multi", label: "Several stops in a country or region" } },
      { field: { ref: "destination" }, type: "text", text: "Egypt" },
      { field: { ref: "days" }, type: "number", number: 10 },
    ]);
    expect(r).toMatchObject({ mode: "multi", destination: "Egypt", days: 10 });
    expect(typeformWantsBrowse([{ field: { ref: "trip_type" }, type: "choice", choice: { ref: "trip_type_browse" } }])).toBe(true);
    expect(typeformWantsBrowse([{ field: { ref: "trip_type" }, type: "choice", choice: { ref: "trip_type_one" } }])).toBe(false);
    const def = typeformDefinition({ browseUrl: "https://www.pylos.ai/browse" });
    expect(def.fields[0]!.ref).toBe("trip_type");
    expect(def.thankyou_screens.find((t) => t.ref === "browse")).toBeTruthy();
  });
});

import { fitItineraryToDays } from "../src";

describe("fitItineraryToDays", () => {
  const stop = (name: string) => ({ time: "10:00", name, neighborhood: "", why: "", localTip: "", source: "locals" as const });
  const day = (label: string, city?: string) => ({ label, theme: label, city, stops: [stop(`${city ?? "x"} ${label}`)] });
  it("keeps the first days of a one-place trip and relabels them", () => {
    const it0 = ItinerarySchema.parse({ title: "T", summary: "", notes: [], days: [day("Day 1"), day("Day 2"), day("Day 3")], hotels: [], replaced: [] });
    const out = fitItineraryToDays(it0, 2);
    expect(out.days.map((d) => d.label)).toEqual(["Day 1", "Day 2"]);
    expect(fitItineraryToDays(it0, 5)).toBe(it0);
  });
  it("drops later stops and shares the days on a multi-city route", () => {
    const leg = (city: string, days: number) => ({ city, region: "", days, why: "", transfer: null, dayThemes: [] });
    const it0 = ItinerarySchema.parse({
      title: "Nile",
      summary: "",
      notes: [],
      mode: "multi",
      route: [leg("Cairo", 3), leg("Luxor", 2), leg("Aswan", 2)],
      days: [day("Day 1", "Cairo"), day("Day 2", "Cairo"), day("Day 3", "Cairo"), day("Day 4", "Luxor"), day("Day 5", "Luxor"), day("Day 6", "Aswan"), day("Day 7", "Aswan")],
      hotels: [{ name: "H Cairo", city: "Cairo", neighborhood: "", style: "", nightly: "", why: "", localTip: "", source: "press" }, { name: "H Aswan", city: "Aswan", neighborhood: "", style: "", nightly: "", why: "", localTip: "", source: "press" }],
      replaced: [],
    });
    const three = fitItineraryToDays(it0, 3);
    expect(three.route!.map((l) => `${l.city}:${l.days}`)).toEqual(["Cairo:3"]);
    expect(three.days.every((d) => d.city === "Cairo")).toBe(true);
    expect(three.hotels.map((h) => h.name)).toEqual(["H Cairo"]);
    const four = fitItineraryToDays(it0, 4);
    expect(four.route!.map((l) => `${l.city}:${l.days}`)).toEqual(["Cairo:2", "Luxor:2"]);
    expect(four.days.map((d) => d.label)).toEqual(["Day 1", "Day 2", "Day 3", "Day 4"]);
    const six = fitItineraryToDays(it0, 6);
    expect(six.route!.map((l) => l.days).reduce((a, b) => a + b, 0)).toBe(6);
    expect(six.days).toHaveLength(6);
  });
});

describe("seasons and city swaps", () => {
  it("takes the travel month from the start date, then the picked month", async () => {
    const { travelMonth, seasonBlock } = await import("../src");
    expect(travelMonth({ startDate: "2027-07-14", month: 3 })).toBe(7);
    expect(travelMonth({ startDate: null, month: 3 })).toBe(3);
    expect(travelMonth({ startDate: null })).toBeNull();
    const july = seasonBlock(TripRequestSchema.parse({ ...req, mode: "multi", destination: "Greece", days: 8, month: 7 }));
    expect(july).toMatch(/They travel in July/);
    expect(july).toMatch(/Beach, island and swimming stops only/);
    expect(seasonBlock(TripRequestSchema.parse({ ...req, mode: "multi", destination: "Greece", days: 8 }))).toMatch(/haven't said when/);
  });
  it("keeps a route leg whose swaps or season came back malformed", async () => {
    const { RouteLegSchema } = await import("../src");
    const ok = RouteLegSchema.parse({ city: "Naxos", days: 3, why: "Beaches", season: "Sea at 25°C", alternatives: [{ city: "Paros", why: "Livelier" }, { why: "no city" }], dayThemes: [] });
    expect(ok.alternatives).toEqual([{ city: "Paros", why: "Livelier" }]);
    const bad = RouteLegSchema.parse({ city: "Naxos", days: 3, why: "", season: { x: 1 }, alternatives: "Paros", dayThemes: [] });
    expect(bad.season).toBeUndefined();
    expect(bad.alternatives).toBeUndefined();
  });
  it("accepts a city swap and rejects markup in the name", async () => {
    const { EditSchema } = await import("../src");
    expect(EditSchema.parse({ action: "swap_city", leg: 1, city: " Sorrento " })).toEqual({ action: "swap_city", leg: 1, city: "Sorrento" });
    expect(EditSchema.safeParse({ action: "swap_city", leg: 1, city: "<b>x</b>" }).success).toBe(false);
    expect(EditSchema.safeParse({ action: "swap_city", leg: 9, city: "Rome" }).success).toBe(false);
  });
});

describe("city picks for quick logging", () => {
  it("validates the country, drops bad and duplicate places", async () => {
    const { CityPicksSchema } = await import("../src");
    const r = CityPicksSchema.parse({
      found: true,
      city: "Lisbon",
      countryCode: "pt",
      picks: [
        { kind: "food", name: "Taberna da Rua das Flores", note: "Petiscos · Chiado" },
        { kind: "food", name: "taberna da rua das flores", note: "dupe" },
        { kind: "spaceship", name: "Nope", note: "" },
        { kind: "stay", name: "Memmo Alfama", note: "Boutique hotel · Alfama" },
      ],
    });
    expect(r.countryCode).toBe("PT");
    expect(r.picks.map((p) => p.name)).toEqual(["Taberna da Rua das Flores", "Memmo Alfama"]);
    expect(CityPicksSchema.parse({ found: false, city: "Xyzzy", countryCode: "ZZ", picks: "none" })).toMatchObject({ found: false, countryCode: null, picks: [] });
  });
  it("groups every kind it asks for", async () => {
    const { PICK_GROUPS, PICK_KINDS } = await import("../src");
    expect(PICK_GROUPS.flatMap((g) => g.kinds).sort()).toEqual([...PICK_KINDS].sort());
  });
});

describe("pick names", () => {
  it("treats reordered, accented and 'the' names as one place", async () => {
    const { pickKey } = await import("../src");
    expect(pickKey("Cafe Majestic")).toBe(pickKey("Majestic Café"));
    expect(pickKey("The Yeatman")).toBe(pickKey("Yeatman"));
    expect(pickKey("Casa Guedes")).not.toBe(pickKey("Casa Lusitana"));
  });
});

describe("trips from imported places", () => {
  it("makes one trip per city and year, skipping places without a country or date", async () => {
    const { tripsFromSignals } = await import("../src");
    const trips = tripsFromSignals([
      { kind: "city", name: "Lisbon", city: null, countryCode: "PT", date: "2024-05-02" },
      { kind: "food", name: "Taberna da Rua das Flores", city: "Lisbon", countryCode: "PT", date: "2024-05-03" },
      { kind: "stay", name: "Hoshinoya", city: "Kyoto", countryCode: "JP", date: "2023-11-20" },
      { kind: "food", name: "Somewhere", city: "Nowhere", countryCode: null, date: "2023-01-01" },
      { kind: "food", name: "Undated", city: "Paris", countryCode: "FR", date: null },
    ]);
    expect(trips.map((t) => `${t.city} ${t.countryCode} ${t.year}-${t.month}`)).toEqual(["Lisbon PT 2024-5", "Kyoto JP 2023-11"]);
  });
});

describe("trips from photo locations", () => {
  it("finds home, then each place visited away from it", async () => {
    const { photoStays } = await import("../src");
    const home = { lat: 40.72, lng: -73.99 }; // New York
    const days = (from: string, n: number, at: { lat: number; lng: number }) =>
      Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10), lat: at.lat + i * 0.001, lng: at.lng }));
    const points = [
      ...days("2024-01-01", 60, home),
      ...days("2024-05-01", 3, { lat: 41.9, lng: 12.5 }), // Rome
      ...days("2024-05-04", 2, { lat: 43.77, lng: 11.25 }), // Florence, straight after
      ...days("2024-08-10", 1, { lat: 40.73, lng: -73.6 }), // a day 33 km out: still home
      ...days("2025-02-01", 4, { lat: 38.72, lng: -9.14 }), // Lisbon
    ];
    const stays = photoStays(points);
    expect(stays.map((s) => `${s.start}+${s.days}`)).toEqual(["2024-05-01+3", "2024-05-04+2", "2025-02-01+4"]);
    expect(stays[0]).toMatchObject({ lat: 41.9, lng: 12.5 });
    // Centres are rounded to about 1 km.
    expect(stays.every((s) => Math.round(s.lat * 100) / 100 === s.lat)).toBe(true);
  });
});

describe("the trip's personal line", () => {
  it("is asked for only when history gives a reason, and never required", async () => {
    const { OUTLINE_TOOL, ROUTE_TOOL, LEG_TOOL, buildOutlinePrompt, buildRoutePrompt, SYSTEM_PROMPT } = await import("../src");
    for (const tool of [OUTLINE_TOOL, ROUTE_TOOL]) {
      const props = tool.input_schema.properties as Record<string, { description?: string }>;
      expect(props.summary).toBeUndefined();
      expect(props.forYou?.description).toMatch(/Otherwise an empty string/);
      expect(tool.input_schema.required as readonly string[]).not.toContain("forYou");
    }
    expect((LEG_TOOL.input_schema.properties as Record<string, unknown>).summary).toBeUndefined();
    const eff = blendWeights(app);
    const lists = { alwaysFeature: "", neverRecommend: "" };
    expect(buildOutlinePrompt(req, eff, lists, [])).toContain('"forYou": empty unless their travel history');
    expect(buildRoutePrompt({ ...req, mode: "multi", destination: "Portugal", days: 6 }, eff, lists)).toContain('"forYou": empty unless');
    expect(SYSTEM_PROMPT).toContain("hidden gem");
  });

  it("parses from the outline, and older trips without one still parse", () => {
    const o = OutlineSchema.parse({ title: "Porto: tascas and port", forYou: "Built around the tascas you rated in Lisbon.", notes: [], days: [{ label: "Day 1", theme: "Ribeira", area: "Ribeira", candidateIds: [] }] });
    expect(o.forYou).toBe("Built around the tascas you rated in Lisbon.");
    expect(OutlineSchema.parse({ title: "T", notes: [], days: [{ label: "Day 1", theme: "A", area: "A", candidateIds: [] }] }).forYou).toBe("");
    expect(ItinerarySchema.parse(itinerary).forYou).toBeUndefined();
  });

  it("is never shown to other people, and neither are the stops' For you notes", async () => {
    const { publicItinerary } = await import("../src");
    const mine: Itinerary = {
      ...itinerary,
      summary: "A generic description.",
      forYou: "Built around the tascas you rated five stars in Lisbon.",
      days: [{ ...itinerary.days[0]!, stops: itinerary.days[0]!.stops.map((s) => ({ ...s, forYou: "Like Taberna da Rua das Flores" })) }],
      hotels: itinerary.hotels.map((h) => ({ ...h, forYou: "Your kind of small hotel" })),
    };
    const pub = publicItinerary(mine);
    expect(pub.forYou).toBe("");
    expect(pub.summary).toBe("");
    expect(pub.days[0]!.stops.every((s) => !("forYou" in s))).toBe(true);
    expect(pub.hotels.every((h) => !("forYou" in h))).toBe(true);
    expect(mine.forYou).toContain("Lisbon");
  });
});
