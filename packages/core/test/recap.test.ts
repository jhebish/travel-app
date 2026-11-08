import { describe, expect, it } from "vitest";
import { memoriesFor, memoryLine, recapYears, tasteUnlock, travelPersonality, yearRecap, type RecapSignal, type RecapTrip } from "../src";

const NOW = new Date("2026-11-07T15:00:00Z").getTime();

const t = (id: string, city: string, countryCode: string, year: number | null, month: number | null, extra: Partial<RecapTrip> = {}): RecapTrip => ({
  id,
  city,
  countryCode,
  year,
  month,
  days: null,
  rating: null,
  ...extra,
});
const s = (pastTripId: string | null, name: string, extra: Partial<RecapSignal> = {}): RecapSignal => ({ pastTripId, kind: "food", name, ...extra });

const TRIPS: RecapTrip[] = [
  t("lis", "Lisbon", "PT", 2026, 3, { days: 5, rating: 4 }),
  t("por", "Porto", "pt", 2026, 4, { days: 3, rating: 5 }),
  t("kyo", "Kyoto", "JP", 2026, 6, { days: 7, rating: 4, rankScore: 0.9 }),
  t("osa", "Osaka", "JP", 2026, 6, { rating: 5, rankScore: 0.2 }),
  t("cdmx", "Mexico City", "MX", 2026, 12, { days: 6 }), // still ahead: an import
  t("par", "Paris", "FR", 2026, 11, { days: 2 }), // this month: might be ahead
  t("rom", "Rome", "IT", 2024, 9, { days: 4 }),
  t("old", "Lyon", "FR", null, null),
  t("bcn", "Barcelona", "ES", 2025, 5),
];

describe("yearRecap", () => {
  const r = yearRecap(TRIPS, [], 2026, NOW);

  it("counts the year's trips that are over, with cities per country", () => {
    expect(r.year).toBe(2026);
    expect(r.trips).toBe(4);
    expect(r.cities).toBe(4);
    expect(r.countries).toBe(2);
  });

  it("finds countries visited for the first time (undated trips count as before)", () => {
    expect(r.newCountries).toEqual(["PT", "JP"]);
    const withEarlierJapan = yearRecap([...TRIPS, t("tok", "Tokyo", "JP", 2023, 1)], [], 2026, NOW);
    expect(withEarlierJapan.newCountries).toEqual(["PT"]);
    // France was visited at some unknown time (Lyon), so a later French trip isn't new.
    expect(yearRecap(TRIPS, [], 2026, new Date("2027-02-01T15:00:00Z").getTime()).newCountries).toEqual(["PT", "JP", "MX"]);
    expect(yearRecap([...TRIPS], [], 2026, new Date("2027-02-01T15:00:00Z").getTime()).countries).toBe(4);
  });

  it("adds up days away, noting trips without a length", () => {
    expect(r.daysAway).toBe(15);
    expect(r.daysUnknown).toBe(1);
  });

  it("picks the top city by their own ranking, then stars", () => {
    expect(r.topCity).toEqual({ city: "Kyoto", countryCode: "JP", pastTripId: "kyo" });
    const unranked = yearRecap(
      TRIPS.map((x) => ({ ...x, rankScore: null })),
      [],
      2026,
      NOW,
    );
    expect(unranked.topCity?.city).toBe("Porto"); // 5 stars and longer than Osaka
  });

  it("picks the top place by ranking, then stars, then likes, from this year's trips only", () => {
    const signals = [
      s("lis", "Taberna da Rua das Flores", { liked: true }),
      s("kyo", "Kinmata", { rating: 5 }),
      s("kyo", "Bar K6", { rankScore: 0.7 }),
      s("rom", "Roscioli", { rankScore: 0.99 }), // 2024
      s("cdmx", "Contramar", { rankScore: 1 }), // a trip still ahead
      s("osa", "Kushikatsu Daruma", { liked: false, rankScore: 0.95 }), // didn't love it
      s("kyo", "Kyoto", { kind: "city", liked: true, rankScore: 2 }),
      s(null, "Septime", { rankScore: 0.8, date: "2026-12-12" }), // dated, not yet
      s(null, "Café de Flore", { rating: 4, date: "2026-02-03" }),
    ];
    expect(yearRecap(TRIPS, signals, 2026, NOW).topPlace).toEqual({ name: "Bar K6", kind: "food", city: null });
    expect(yearRecap(TRIPS, signals.filter((x) => x.name !== "Bar K6"), 2026, NOW).topPlace?.name).toBe("Kinmata");
    expect(yearRecap(TRIPS, [s("lis", "A", { liked: true }), s(null, "B", { rating: 4, date: "2026-02-03" })], 2026, NOW).topPlace?.name).toBe("B");
    expect(yearRecap(TRIPS, [s("lis", "Meh", { rating: 3 })], 2026, NOW).topPlace).toBeNull();
  });

  it("is empty for a year without trips", () => {
    const empty = yearRecap(TRIPS, [], 2022, NOW);
    expect(empty).toMatchObject({ trips: 0, cities: 0, countries: 0, newCountries: [], daysAway: 0, topCity: null, topPlace: null });
  });
});

describe("recapYears", () => {
  it("lists the years with trips that are over, newest first", () => {
    expect(recapYears(TRIPS, NOW)).toEqual([2026, 2025, 2024]);
    expect(recapYears([t("x", "Lima", "PE", 2027, 1)], NOW)).toEqual([]);
  });
});

describe("travelPersonality", () => {
  const base = { stays: { styles: [], price: "", likes: [], avoid: [] }, food: { cuisines: [], vibes: [], price: "", avoid: [] }, activities: [] };

  it("uses the first sentence of the taste summary", () => {
    expect(travelPersonality({ ...base, summary: "You like small design hotels and long lunches. You avoid big resorts." })).toBe(
      "You like small design hotels and long lunches.",
    );
  });

  it("keeps it to one line", () => {
    const long = `You ${"really ".repeat(40)}like natural wine.`;
    const line = travelPersonality({ ...base, summary: long })!;
    expect(line.length).toBeLessThanOrEqual(140);
    expect(line.endsWith("…")).toBe(true);
  });

  it("falls back to a few traits, or nothing", () => {
    expect(
      travelPersonality({ ...base, summary: "", stays: { ...base.stays, styles: ["boutique"] }, food: { ...base.food, vibes: ["Natural wine"] }, activities: ["Long walks"] }),
    ).toBe("Boutique · natural wine · long walks");
    expect(travelPersonality({ ...base, summary: "  " })).toBeNull();
    expect(travelPersonality(null)).toBeNull();
  });
});

describe("memories", () => {
  const today = { year: 2026, month: 11 };
  const trips = [
    { id: "a", city: "Kyoto", year: 2025, month: 11 },
    { id: "b", city: "Lisbon", year: 2022, month: 11 },
    { id: "c", city: "Paris", year: 2026, month: 11 }, // this year: not a memory yet
    { id: "d", city: "Rome", year: 2024, month: 10 },
    { id: "e", city: "Lima", year: null, month: 11 },
  ];

  it("finds trips from this month in earlier years, most recent first", () => {
    expect(memoriesFor(trips, today).map((x) => x.id)).toEqual(["a", "b"]);
    expect(memoriesFor(trips, { year: 2026, month: 3 })).toEqual([]);
  });

  it("says how long ago, in words", () => {
    expect(memoryLine({ city: "Kyoto", year: 2025 }, today)).toBe("A year ago you were in Kyoto");
    expect(memoryLine({ city: "Lisbon", year: 2022 }, today)).toBe("Four years ago you were in Lisbon");
    expect(memoryLine({ city: "Cairo", year: 2001 }, today)).toBe("25 years ago you were in Cairo");
  });
});

describe("tasteUnlock", () => {
  it("unlocks at three logged trips", () => {
    expect(tasteUnlock(0)).toEqual({ unlocked: false, have: 0, need: 3 });
    expect(tasteUnlock(1)).toEqual({ unlocked: false, have: 1, need: 3 });
    expect(tasteUnlock(3)).toEqual({ unlocked: true, have: 3, need: 3 });
    expect(tasteUnlock(12)).toEqual({ unlocked: true, have: 3, need: 3 });
    expect(tasteUnlock(Number.NaN)).toEqual({ unlocked: false, have: 0, need: 3 });
  });
});
