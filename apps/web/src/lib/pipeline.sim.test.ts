/**
 * Whole builds with a stand-in model: the day check and the famous-sights check, wired through
 * planItinerary as on the site. Claude, Google Places and the database are replaced at the module
 * boundary; everything else (prompts, schemas, checks, the rebuild) is the real code.
 */
import { DAY_TOOL, OUTLINE_TOOL, ROUTE_TOOL, TripRequestSchema, blendWeights, defaultWeights, type Candidate } from "@travel/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  callTool: vi.fn(),
  placesCandidates: vi.fn(),
}));

vi.mock("./claude", () => ({ callTool: h.callTool }));
vi.mock("./places", () => ({
  PlacesError: class PlacesError extends Error {},
  placesCandidates: h.placesCandidates,
  placesEnabled: () => false,
  placeById: async () => null,
  verifyPlace: async () => null,
}));
vi.mock("./supabase/server", () => {
  // Any query chain resolves to "no rows" (no approved local picks).
  const query: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === "then" ? (done: (v: unknown) => void) => done({ data: [], error: null }) : () => query) },
  );
  return { supabaseAdmin: () => query };
});
vi.mock("./feedback", () => ({ syncFeedback: async () => {} }));
vi.mock("./hotels", () => ({ adultsFor: () => 2, attachLiveRates: async () => {} }));
vi.mock("./taste", () => ({ tasteBlock: async () => "" }));
vi.mock("./together", () => ({ addFriendsOnCreate: async () => {}, companionsFromHandles: async () => [], editPeople: async () => ({ companions: [] }) }));
vi.mock("./tripAccess", () => ({ rateLimit: async () => {}, updateTrip: async () => {} }));
vi.mock("./trips", () => ({ toTrip: (r: unknown) => r }));

const { planItinerary } = await import("./pipeline");

// ---------------------------------------------------------------------------
// Places: what a Google search would return, with real coordinates.
// ---------------------------------------------------------------------------
type Where = { lat: number; lng: number };
const place = (id: string, name: string, category: Candidate["category"], tags: string[], ratingCount: number, at: Where, city: string): Candidate & { city: string } => ({
  id: `gp_${id}`,
  origin: "google",
  name,
  category,
  source: "reviews",
  tags,
  rating: 4.5,
  ratingCount,
  placeId: `pid_${id}`,
  verification: { placeId: `pid_${id}`, lat: at.lat, lng: at.lng },
  city,
});
const ALGIERS = { lat: 36.7538, lng: 3.0588 };
const CAIRO = { lat: 30.0444, lng: 31.2357 };
const GIZA = { lat: 29.9792, lng: 31.1342 };
const LUXOR = { lat: 25.6872, lng: 32.6396 };
const near = (p: Where, dLat: number, dLng: number) => ({ lat: p.lat + dLat, lng: p.lng + dLng });

const PLACES = [
  place("tanto", "Café Tantonville", "food", ["cafe", "food"], 3000, ALGIERS, "Algiers"),
  place("milk", "Milk Bar", "food", ["cafe", "food"], 2500, near(ALGIERS, 0.002, 0.001), "Algiers"),
  place("patis", "Pâtisserie Aïn Taya", "food", ["bakery", "food"], 900, near(ALGIERS, 0.004, 0.002), "Algiers"),
  place("bahdja", "Café El Bahdja", "food", ["cafe", "food"], 1200, near(ALGIERS, 0.003, -0.002), "Algiers"),
  place("casbah", "Casbah of Algiers", "culture", ["tourist_attraction", "historical_landmark"], 9000, near(ALGIERS, 0.01, -0.003), "Algiers"),
  place("hamma", "Jardin d'Essai du Hamma", "outdoors", ["park", "tourist_attraction"], 15000, near(ALGIERS, -0.01, 0.03), "Algiers"),
  place("djazair", "El Djazair", "food", ["restaurant", "food"], 1500, near(ALGIERS, 0.001, 0.004), "Algiers"),
  place("pecherie", "La Pêcherie", "food", ["seafood_restaurant", "restaurant"], 2200, near(ALGIERS, 0.006, 0.006), "Algiers"),

  place("karnak", "Karnak Temple Complex", "culture", ["tourist_attraction", "historical_landmark"], 200_000, near(LUXOR, 0.032, 0.018), "Luxor"),
  place("lxtemple", "Luxor Temple", "culture", ["tourist_attraction"], 60_000, LUXOR, "Luxor"),
  place("kings", "Valley of the Kings", "culture", ["tourist_attraction"], 50_000, near(LUXOR, 0.053, -0.04), "Luxor"),
  place("sofra", "Sofra Restaurant", "food", ["restaurant", "food"], 6000, near(LUXOR, 0.004, 0.003), "Luxor"),
  place("pyr", "Pyramids of Giza", "culture", ["tourist_attraction", "historical_landmark"], 150_000, GIZA, "Cairo"),
  place("museum", "Egyptian Museum", "culture", ["museum", "tourist_attraction"], 60_000, near(CAIRO, 0.0035, -0.0, ), "Cairo"),
  place("coptic", "Coptic Cairo", "culture", ["tourist_attraction"], 15_000, { lat: 30.006, lng: 31.2302 }, "Cairo"),
  place("khan", "Khan el-Khalili", "shopping", ["market", "tourist_attraction"], 40_000, near(CAIRO, 0.003, 0.027), "Cairo"),
  place("abou", "Koshary Abou Tarek", "food", ["restaurant", "food"], 20_000, near(CAIRO, 0.006, 0.006), "Cairo"),
  place("riche", "Café Riche", "food", ["cafe", "food"], 8000, near(CAIRO, -0.002, 0.004), "Cairo"),
  place("naguib", "Naguib Mahfouz Café", "food", ["restaurant", "food"], 5000, near(CAIRO, 0.004, 0.027), "Cairo"),
];

/** A Places search: the places in the city the query names (Egypt alone means all of Egypt), in the query's category. */
h.placesCandidates.mockImplementation(async (query: string, category: string) => {
  const city = ["Algiers", "Luxor", "Cairo"].find((c) => query.includes(c));
  return PLACES.filter((p) => (city ? p.city === city : p.city !== "Algiers") && (p.category === category || category === "culture" && p.category === "outdoors")).map(({ city: _c, ...c }) => c);
});

// ---------------------------------------------------------------------------
// The stand-in model
// ---------------------------------------------------------------------------
const ids = (...names: string[]) => names.map((n) => `gp_${n}`);
const stop = (time: string, id: string, kind: string) => {
  const p = PLACES.find((x) => x.id === `gp_${id}`)!;
  return { time, name: p.name, neighborhood: p.city, why: "", localTip: "", source: "locals", candidateId: p.id, kind };
};
/** The places a day prompt says it must include ("- Must include X and Y: …"). */
const mustIncludes = (prompt: string) => /- Must include (.+?): (?:an essential sight|essential sights)/.exec(prompt)?.[1]?.split(" and ") ?? [];
const isRebuild = (prompt: string) => prompt.includes("A FIRST DRAFT OF THIS DAY WAS REJECTED");
const reply = (input: unknown) => ({ input, model: "stand-in" });

const eff = blendWeights({ weights: defaultWeights(), blocked: [] }, { useCustom: false, weights: {}, blocked: [] });
const lists = { alwaysFeature: "", neverRecommend: "" };
const request = (r: Record<string, unknown>) => TripRequestSchema.parse({ party: "Couple", budget: "Mid-range", pace: "Balanced", ...r });
const dayPrompts = () => h.callTool.mock.calls.filter((c) => c[1] === DAY_TOOL).map((c) => c[0] as string);
const names = (stops: { name: string }[]) => stops.map((s) => s.name);

beforeEach(() => {
  h.callTool.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a build with the day check", () => {
  it("rebuilds the Algiers day of four cafés into a mixed day", async () => {
    h.callTool.mockImplementation(async (prompt: string, tool: unknown) => {
      if (tool === OUTLINE_TOOL)
        return reply({ title: "Algiers in a day", days: [{ label: "Day 1", theme: "Cafés of the centre", area: "Centre", candidateIds: ids("tanto", "milk", "patis", "bahdja", "casbah"), mustSee: [] }] });
      if (tool === DAY_TOOL)
        return isRebuild(prompt)
          ? reply({ stops: [stop("09:00", "tanto", "coffee"), stop("10:30", "casbah", "sight"), stop("13:00", "djazair", "meal"), stop("15:30", "hamma", "nature"), stop("20:00", "pecherie", "meal")] })
          : reply({ stops: [stop("09:00", "tanto", "coffee"), stop("11:00", "milk", "coffee"), stop("14:00", "patis", "coffee"), stop("17:00", "bahdja", "coffee")] });
      throw new Error("unexpected tool");
    });
    const { itin } = await planItinerary(request({ destination: "Algiers", days: 1, interests: ["Food"] }), { eff, lists, history: "" });

    expect(names(itin.days[0]!.stops)).toEqual(["Café Tantonville", "Casbah of Algiers", "El Djazair", "Jardin d'Essai du Hamma", "La Pêcherie"]);
    const [, rebuild] = dayPrompts();
    expect(rebuild).toMatch(/It has 4 café or coffee stops\. Keep at most 1\./);
    expect(rebuild).toMatch(/nothing to see or do/);
  });

  it("doesn't let the 'Food' interest excuse a day of only eating", async () => {
    h.callTool.mockImplementation(async (prompt: string, tool: unknown) => {
      if (tool === OUTLINE_TOOL) return reply({ title: "Algiers", days: [{ label: "Day 1", theme: "Eat", area: "Centre", candidateIds: ids("tanto", "djazair", "pecherie"), mustSee: [] }] });
      if (tool === DAY_TOOL)
        return isRebuild(prompt)
          ? reply({ stops: [stop("09:00", "tanto", "coffee"), stop("10:30", "casbah", "sight"), stop("13:00", "djazair", "meal"), stop("20:00", "pecherie", "meal")] })
          : reply({ stops: [stop("09:00", "tanto", "coffee"), stop("12:30", "djazair", "meal"), stop("16:00", "milk", "coffee"), stop("20:00", "pecherie", "meal")] });
      throw new Error("unexpected tool");
    });
    const { itin } = await planItinerary(request({ destination: "Algiers", days: 1, interests: ["Food"] }), { eff, lists, history: "" });
    expect(names(itin.days[0]!.stops)).toContain("Casbah of Algiers");
  });

  it("leaves an asked-for coffee crawl alone", async () => {
    h.callTool.mockImplementation(async (_prompt: string, tool: unknown) => {
      if (tool === OUTLINE_TOOL) return reply({ title: "Coffee crawl", days: [{ label: "Day 1", theme: "Cafés", area: "Centre", candidateIds: ids("tanto", "milk", "patis", "bahdja"), mustSee: [] }] });
      if (tool === DAY_TOOL) return reply({ stops: [stop("09:00", "tanto", "coffee"), stop("11:00", "milk", "coffee"), stop("14:00", "patis", "coffee"), stop("17:00", "bahdja", "coffee")] });
      throw new Error("unexpected tool");
    });
    const { itin } = await planItinerary(request({ destination: "Algiers", days: 1, extra: "A coffee crawl, please" }), { eff, lists, history: "" });
    expect(itin.days[0]!.stops).toHaveLength(4);
    expect(dayPrompts()).toHaveLength(1);
  });
});

describe("a build with the famous-sights check", () => {
  /** Two days in Cairo, as a fast model might outline them: no Pyramids anywhere. */
  const cairoOutline = () =>
    reply({
      title: "Two days in Cairo",
      days: [
        { label: "Day 1", theme: "Downtown and the bazaar", area: "Downtown", candidateIds: ids("museum", "khan", "abou", "riche"), mustSee: ["Egyptian Museum"] },
        { label: "Day 2", theme: "Old Cairo", area: "Coptic Cairo", candidateIds: ids("coptic", "naguib"), mustSee: [] },
      ],
    });

  it("gets the Pyramids into two days in Egypt, even when the day's first draft leaves them out", async () => {
    h.callTool.mockImplementation(async (prompt: string, tool: unknown) => {
      if (tool === OUTLINE_TOOL) return cairoOutline();
      if (tool === DAY_TOOL) {
        const must = mustIncludes(prompt);
        // A careless first draft; the rebuild does what the problems say.
        if (must.includes("Pyramids of Giza") && isRebuild(prompt))
          return reply({ stops: [stop("08:00", "pyr", "sight"), stop("12:30", "abou", "meal"), stop("15:00", "coptic", "sight"), stop("19:30", "naguib", "meal")] });
        if (prompt.includes("Plan Day 1"))
          return reply({ stops: [stop("09:00", "riche", "coffee"), stop("10:00", "museum", "sight"), stop("13:00", "abou", "meal"), stop("16:00", "khan", "market"), stop("20:00", "naguib", "meal")] });
        return reply({ stops: [stop("10:00", "coptic", "sight"), stop("13:00", "naguib", "meal"), stop("16:00", "khan", "market")] });
      }
      throw new Error("unexpected tool");
    });
    const { itin } = await planItinerary(request({ destination: "Egypt", days: 2 }), { eff, lists, history: "" });

    const all = itin.days.flatMap((d) => names(d.stops));
    expect(all).toContain("Pyramids of Giza");
    expect(all).not.toContain("Karnak Temple Complex");
    // Day 2 (Coptic Cairo is nearer Giza than downtown) was told, checked and rebuilt.
    expect(names(itin.days[1]!.stops)).toContain("Pyramids of Giza");
    const prompts = dayPrompts();
    expect(prompts.filter((p) => mustIncludes(p).includes("Pyramids of Giza"))).toHaveLength(2); // the draft and its rebuild
    expect(prompts.some((p) => /It leaves out Pyramids of Giza/.test(p))).toBe(true);
  });

  it("leaves a returning traveler's Cairo to the planner", async () => {
    h.callTool.mockImplementation(async (_prompt: string, tool: unknown) => {
      if (tool === OUTLINE_TOOL) return cairoOutline();
      if (tool === DAY_TOOL) return reply({ stops: [stop("10:00", "coptic", "sight"), stop("13:00", "naguib", "meal"), stop("16:00", "khan", "market")] });
      throw new Error("unexpected tool");
    });
    const history = "TRAVEL HISTORY (3 countries, 5 cities)\n- Cairo, Egypt (2019), rated 5/5\nThey have been to Cairo before: skip the obvious first-timer sights unless asked.";
    await planItinerary(request({ destination: "Cairo", days: 2 }), { eff, lists, history });
    expect(dayPrompts().some((p) => mustIncludes(p).length > 0 && mustIncludes(p).includes("Pyramids of Giza"))).toBe(false);
  });

  it("gives each stop of a route its own headline sight, not on the day you arrive", async () => {
    h.callTool.mockImplementation(async (prompt: string, tool: unknown) => {
      if (tool === ROUTE_TOOL)
        return reply({
          title: "Cairo and Luxor",
          legs: [
            { city: "Cairo", days: 2, dayThemes: [{ theme: "Downtown", area: "Downtown" }, { theme: "Old Cairo", area: "Coptic Cairo" }] },
            { city: "Luxor", days: 2, transfer: { mode: "Train", duration: "10 h", note: "" }, dayThemes: [{ theme: "Arriving", area: "East Bank" }, { theme: "Temples", area: "East Bank" }] },
          ],
        });
      if (tool === DAY_TOOL) {
        const must = mustIncludes(prompt);
        const stops = must.map((m, i) => ({ ...stop(`${9 + i * 3}:00`.padStart(5, "0"), PLACES.find((p) => p.name === m)!.id.slice(3), "sight") }));
        const meal = prompt.includes("Luxor") ? "sofra" : "abou";
        return reply({ stops: [...stops, stop("13:30", meal, "meal"), stop("20:00", meal === "sofra" ? "sofra" : "naguib", "meal")] });
      }
      throw new Error("unexpected tool");
    });
    const { itin } = await planItinerary(request({ destination: "Egypt", days: 4, mode: "multi" }), { eff, lists, history: "" });

    const day = (n: number) => names(itin.days[n]!.stops);
    expect([...day(0), ...day(1)]).toContain("Pyramids of Giza");
    expect(day(2)).not.toContain("Karnak Temple Complex"); // the travel day
    expect(day(3)).toContain("Karnak Temple Complex");
  });
});
