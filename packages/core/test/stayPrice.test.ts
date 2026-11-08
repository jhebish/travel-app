import { describe, expect, it } from "vitest";
import {
  StayScaleSchema,
  TripRequestSchema,
  blendWeights,
  buildHotelPromptForAreas,
  candidateBlock,
  defaultWeights,
  nicePrice,
  scoreCandidate,
  stayLabel,
  stayRules,
  stayTier,
  tierForNightly,
  tierForPriceLevel,
  tierLabel,
  tierRange,
  typeformToRequest,
  type Candidate,
  type StayScale,
} from "../src";

const egypt: StayScale = { cuts: [40, 110, 250] };
const paris: StayScale = { cuts: [150, 300, 600] };

describe("hotel prices as tiers judged by local prices", () => {
  it("puts a nightly price in the tier it buys there", () => {
    expect([30, 60, 180, 300].map((n) => tierForNightly(n, egypt))).toEqual(["$", "$$", "$$$", "$$$$"]);
    expect([100, 225, 450, 800].map((n) => tierForNightly(n, paris))).toEqual(["$", "$$", "$$$", "$$$$"]);
  });

  it("reads an old dollar answer by what it buys in that place", () => {
    // $150–300 a night is upscale in Egypt, comfortable in Paris.
    expect(stayTier("$150–300", egypt)).toBe("$$$");
    expect(stayTier("$150–300", paris)).toBe("$$");
    expect(stayTier("$300–600", egypt)).toBe("$$$$");
    expect(stayTier("Under $150", egypt)).toBe("$$");
    // Without a scale, as the bands were written (big Western cities).
    expect(stayTier("$150–300")).toBe("$$");
    // Tiers are kept; nothing usable is the middle.
    expect(stayTier("$$$$", egypt)).toBe("$$$$");
    expect(stayTier(null)).toBe("$$");
    expect(stayTier("cheap please")).toBe("$$");
  });

  it("takes Google's price level for a hotel as the local tier", () => {
    expect([1, 2, 3, 4].map(tierForPriceLevel)).toEqual(["$", "$$", "$$$", "$$$$"]);
    expect(tierForPriceLevel(0)).toBe("$");
    expect(tierForPriceLevel(9)).toBe("$$$$");
  });

  it("labels each choice with its local range, or what it means before the place is known", () => {
    expect(["$", "$$", "$$$", "$$$$"].map((t) => tierLabel(t as "$", egypt))).toEqual(["$ · under $40", "$$ · $40–110", "$$$ · $110–250", "$$$$ · $250+"]);
    expect(tierLabel("$$")).toBe("$$ · comfortable");
    expect(tierRange("$$$", { cuts: [150, 400, 1200] })).toBe("$400–1,200");
    expect(tierRange("$$$$", { cuts: [150, 400, 1200] })).toBe("$1,200+");
  });

  it("checks and rounds the model's prices", () => {
    expect([37, 112, 1234].map(nicePrice)).toEqual([35, 110, 1250]);
    expect(StayScaleSchema.parse({ cuts: [38, 113, 247] })).toEqual({ cuts: [40, 110, 250] });
    expect(StayScaleSchema.safeParse({ cuts: [110, 40, 250] }).success).toBe(false); // not rising
    expect(StayScaleSchema.safeParse({ cuts: [100, 102, 300] }).success).toBe(false); // the same once rounded
    expect(StayScaleSchema.safeParse({ cuts: [2, 10, 30] }).success).toBe(false);
    expect(StayScaleSchema.safeParse({ cuts: [Number.NaN, 100, 200] }).success).toBe(false);
  });

  it("asks in tiers now, and still reads older requests in dollars", () => {
    const base = { destination: "Cairo", days: 3, party: "Couple", budget: "Mid-range", pace: "Balanced" };
    expect(TripRequestSchema.parse(base).stay.price).toBe("$$");
    expect(TripRequestSchema.parse({ ...base, stay: { on: true, styles: [], price: "$$$" } }).stay.price).toBe("$$$");
    expect(TripRequestSchema.parse({ ...base, stay: { on: true, styles: [], price: "$150–300" } }).stay.price).toBe("$150–300");
    expect(TripRequestSchema.safeParse({ ...base, stay: { on: true, styles: [], price: "$$$$$" } }).success).toBe(false);
  });

  it("keeps the Typeform's dollar answer for the pipeline to read through the place's prices", () => {
    const answers = [
      { field: { ref: "destination" }, type: "text", text: "Cairo" },
      { field: { ref: "days" }, type: "number", number: 3 },
      { field: { ref: "stay_on" }, type: "boolean", boolean: true },
      { field: { ref: "stay_price" }, type: "choice", choice: { ref: "stay_price_150_300", label: "$150–300" } },
    ];
    expect(typeformToRequest(answers).stay.price).toBe("$150–300");
    expect(typeformToRequest(answers.slice(0, 3)).stay.price).toBe("$$");
  });
});

describe("hotel picks at the right price for the place", () => {
  const req = TripRequestSchema.parse({ destination: "Cairo", days: 3, party: "Couple", budget: "Mid-range", pace: "Balanced", stay: { on: true, styles: [], price: "$$$" } });
  const eff = blendWeights({ weights: defaultWeights(), blocked: [] });
  const stay = (o: Partial<Candidate>): Candidate => ({ id: "x", origin: "local_pick", name: "Hotel", category: "stay", source: "locals", ...o });

  it("prefers the tier asked for, then the one next to it", () => {
    const same = scoreCandidate(stay({ priceBand: "$$$" }), eff, req);
    const near = scoreCandidate(stay({ priceBand: "$$$$" }), eff, req);
    const far = scoreCandidate(stay({ priceBand: "$" }), eff, req);
    expect(same).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    const google = (level: number) => scoreCandidate(stay({ origin: "google", priceLevel: level }), eff, req);
    expect(google(3)).toBeGreaterThan(google(2));
    expect(google(2)).toBeGreaterThan(google(1));
  });

  it("tells the hotel prompt what the tier means there", () => {
    const rules = stayRules(req.stay, 3, egypt);
    expect(rules).toContain("Price: $$$ (upscale by local standards, about $110–250 a night there)");
    expect(rules).toContain("not in a Western capital");
    expect(stayRules({ on: true, styles: [], price: "$150–300" }, 3, egypt)).toContain("Price: $$$ (upscale");
    expect(stayRules(req.stay)).toContain("Price: $$$ (upscale by local standards)");
    expect(buildHotelPromptForAreas(req, eff, { alwaysFeature: "", neverRecommend: "" }, ["Zamalek"], [], 3, egypt)).toContain("about $110–250 a night there");
    expect(stayLabel({ on: true, styles: ["Boutique"], price: "$$$" })).toBe("boutique · $$$");
  });

  it("shows candidates' prices in the same $ terms", () => {
    const block = candidateBlock([
      stay({ id: "lp_1", name: "Villa Belle Epoque", priceBand: "$$$" }),
      { id: "gp_2", origin: "google", name: "Koshary Abou Tarek", category: "food", source: "reviews", priceLevel: 1 },
      { id: "gp_3", origin: "google", name: "Al-Azhar Park", category: "outdoors", source: "reviews", priceLevel: 0 },
    ]);
    expect(block).toContain("Villa Belle Epoque · stay · source:locals · price $$$ for the city");
    expect(block).toMatch(/Koshary Abou Tarek · food · source:reviews · price \$$/m); // inexpensive is one $
    expect(block).toContain("Al-Azhar Park · outdoors · source:reviews · free");
  });
});
