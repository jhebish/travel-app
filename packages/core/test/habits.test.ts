import { describe, expect, it } from "vitest";
import { TASTE_TOOL, TasteProfileSchema, buildTastePrompt, habitLines, monthsText, travelHabits, type HabitTrip } from "../src";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const trip = (city: string, countryCode: string, year: number | null, month: number | null, days: number | null): HabitTrip => ({ city, countryCode, year, month, days });

const history: HabitTrip[] = [
  trip("Lisbon", "PT", 2021, 5, 5),
  trip("Porto", "PT", 2021, 5, 3),
  trip("Rome", "IT", 2022, 7, 6),
  trip("Lisbon", "PT", 2022, 6, 4),
  trip("Bali", "ID", 2023, 8, 12),
  trip("Lisbon", "PT", 2023, 7, 3),
  trip("Paris", "FR", 2024, 7, 4),
  trip("Florence", "IT", 2024, 6, 3),
  trip("Naples", "IT", 2025, 6, 4),
  trip("Lisbon", "PT", 2025, 8, 5),
  trip("Tokyo", "JP", 2027, 4, 7), // booked, not taken yet
];

describe("how someone travels, counted from their trips", () => {
  it("counts how often, how long, when and where they go back", () => {
    const h = travelHabits(history, NOW);
    expect(h).toMatchObject({ trips: 10, since: 2021, typicalDays: 4, longest: { city: "Bali", days: 12, year: 2023 }, countries: 4 });
    expect(h.perYear).toBeCloseTo(10 / 5.85, 1);
    expect(h.peakMonths).toEqual([5, 6, 7, 8]); // May–Jul and Jun–Aug hold 8 of the 10 each
    expect(h.topCountry).toEqual({ code: "PT", years: 4 });
    expect(h.returns).toEqual([{ city: "Lisbon", countryCode: "PT", years: 4 }]);
  });

  it("says it in a few plain sentences, without repeating the city they keep going back to", () => {
    expect(habitLines(travelHabits(history, NOW))).toEqual([
      "10 trips since 2021, about 2 a year.",
      "Usually about 4 days away; the longest was 12 days in Bali (2023).",
      "Most of your trips are between May and August.",
      "4 countries so far.",
      "You keep going back to Lisbon (4 different years).",
    ]);
    // A country visited in more years than any one city in it is worth saying.
    const italy = [...history, trip("Venice", "IT", 2021, 9, 3), trip("Milan", "IT", 2023, 10, 2)];
    expect(habitLines(travelHabits(italy, NOW))).toContain("4 countries so far; you've been to Italy in 5 different years, more than anywhere else.");
  });

  it("reads months across the new year, and leaves out what it can't tell", () => {
    const winter = [trip("Cape Town", "ZA", 2023, 12, 10), trip("Kyoto", "JP", 2024, 1, 6), trip("Oaxaca", "MX", 2025, 2, 5), trip("Paris", "FR", 2025, 1, 3), trip("Rome", "IT", 2024, 5, null)];
    expect(travelHabits(winter, NOW).peakMonths).toEqual([12, 1, 2]);
    expect(monthsText([12, 1, 2])).toBe("between December and February");
    expect(monthsText([7, 8])).toBe("in July and August");
    expect(monthsText([8])).toBe("in August");
    // No months or lengths: just the count and the countries.
    const bare = [trip("Lisbon", "PT", null, null, null), trip("Kyoto", "JP", null, null, null)];
    expect(habitLines(travelHabits(bare, NOW))).toEqual(["2 trips.", "2 countries so far."]);
    // One trip isn't a habit; a short history gets no yearly rate.
    expect(habitLines(travelHabits([trip("Lisbon", "PT", 2025, 5, 4)], NOW))).toEqual([]);
    expect(habitLines(travelHabits([trip("Lisbon", "PT", 2026, 3, 4), trip("Porto", "PT", 2026, 4, 2), trip("Faro", "PT", 2026, 5, 3)], NOW))[0]).toBe("3 trips since 2026.");
  });

  it("puts a slower pace in words", () => {
    const sparse = [trip("Lisbon", "PT", 2016, 5, 4), trip("Kyoto", "JP", 2019, 4, 6), trip("Oaxaca", "MX", 2022, 11, 5), trip("Paris", "FR", 2025, 9, 3)];
    expect(habitLines(travelHabits(sparse, NOW))[0]).toBe("4 trips since 2016, about one every 3 years.");
  });
});

describe("the taste profile reads how they travel", () => {
  const pastTrips = history.map((t) => ({ city: t.city, country: t.countryCode, countryCode: t.countryCode, year: t.year, month: t.month, days: t.days }));

  it("gives the model each trip's month and length, and the counted habits", () => {
    const prompt = buildTastePrompt({ pastTrips, signals: [], feedback: { liked: [], disliked: [] } });
    expect(prompt).toContain("- Bali, ID (Aug 2023, 12 days)");
    expect(prompt).toContain("HOW THEY TRAVEL (counted from all their trips)\n- 10 trips since 2021");
    expect(prompt).toContain("You keep going back to Lisbon");
    // Without countries there's nothing to count from.
    expect(buildTastePrompt({ pastTrips: [{ city: "Lisbon", country: "Portugal", year: 2024 }], signals: [], feedback: { liked: [], disliked: [] } })).not.toContain("HOW THEY TRAVEL");
  });

  it("asks for their travel style and the trips they'd want next, and older profiles still read", () => {
    const props = TASTE_TOOL.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["style", "next"]));
    expect(TASTE_TOOL.input_schema.required).toEqual(expect.arrayContaining(["style", "next"]));
    const base = { summary: "You like small hotels.", stays: { styles: [], price: "", likes: [], avoid: [] }, food: { cuisines: [], vibes: [], price: "", avoid: [] }, activities: [] };
    const p = TasteProfileSchema.parse({ ...base, style: ["You pick coastal towns over big capitals.", ""], next: "A slow week on a Greek island; Somewhere new in Japan" });
    expect(p.style).toEqual(["You pick coastal towns over big capitals."]);
    expect(p.next).toEqual(["A slow week on a Greek island", "Somewhere new in Japan"]);
    expect(TasteProfileSchema.parse(base).style).toBeUndefined();
  });
});
