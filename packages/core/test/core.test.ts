import { describe, expect, it } from "vitest";
import {
  TripRequestSchema,
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
