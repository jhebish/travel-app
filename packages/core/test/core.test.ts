import { describe, expect, it } from "vitest";
import {
  TripRequestSchema,
  DaySchema,
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
