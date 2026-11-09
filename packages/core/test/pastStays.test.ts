import { describe, expect, it } from "vitest";
import { SIGNAL_SOURCES, TasteSignalSchema, groupStays, isGenericStay, nightOf, sleepSpots, staysForPrompt, stayWhen, type StaySignal } from "../src";

const stay = (id: string, name: string, city: string | null, date: string | null, extra: Partial<StaySignal> = {}): StaySignal => ({
  id,
  source: "ics",
  name,
  city,
  countryCode: city === "Lisbon" ? "PT" : city === "Kyoto" ? "JP" : city === "Paris" ? "FR" : null,
  date,
  ...extra,
});

describe("places you've stayed", () => {
  const signals = [
    stay("a", "Memmo Alfama", "Lisbon", "2025-05-11"),
    stay("b", "Memmo Alfama Hotel", "Lisbon", "2025-05-11", { source: "gmail" }), // its confirmation email
    stay("c", "Memmo Alfama", "Lisbon", "2023-09-02", { liked: true }),
    stay("d", "Airbnb in Paris", "Paris", "2024-03-04"),
    stay("e", "Hoshinoya Kyoto", "Kyoto", "2024-11-20", { source: "photos", note: "3 nights, from your photos" }),
    stay("f", "Generator Paris", "Paris", "2022-06-01", { liked: false }),
    stay("g", "Hotel Somewhere", null, null, { source: "manual" }),
  ];

  it("is one list, the same place found twice is one entry, newest first", () => {
    const list = groupStays(signals);
    expect(list.map((s) => s.name)).toEqual(["Memmo Alfama", "Hoshinoya Kyoto", "Airbnb in Paris", "Generator Paris", "Hotel Somewhere"]);
    const memmo = list[0]!;
    expect(memmo).toMatchObject({ ids: ["a", "b", "c"], first: "2023-09-02", last: "2025-05-11", visits: 2, liked: true, sources: ["ics", "gmail"], countryCode: "PT" });
    expect(list.find((s) => s.name === "Airbnb in Paris")!.generic).toBe(true);
    expect(isGenericStay("Hotel Avenida Palace")).toBe(false);
    expect(isGenericStay("Booking.com in Porto")).toBe(true);
    // A dislike on any of an entry's signals wins.
    expect(groupStays([stay("x", "Generator Paris", "Paris", "2022-06-01", { liked: true }), stay("y", "Generator Paris", "Paris", "2023-06-01", { liked: false })])[0]!.liked).toBe(false);
  });

  it("says when, briefly", () => {
    expect(stayWhen({ first: "2023-09-02", last: "2025-05-11" })).toBe("2023–2025");
    expect(stayWhen({ first: "2024-11-20", last: "2024-11-20" })).toBe("Nov 2024");
    expect(stayWhen({ first: null, last: null })).toBe("");
  });

  it("tells the hotel prompt what they chose, what they loved and what to never suggest", () => {
    const block = staysForPrompt(groupStays(signals), "Lisbon, Portugal");
    expect(block).toContain("WHERE THEY'VE STAYED (5 stays");
    expect(block).toContain("- Memmo Alfama (Lisbon, Portugal, 2023–2025) · 2 stays · loved it");
    expect(block).toContain("- Generator Paris (Paris, France, Jun 2022) · didn't like it");
    expect(block).toContain("Never suggest one they didn't like");
    expect(block).toContain("They've stayed in Lisbon before");
    // Loved first.
    expect(block.indexOf("Memmo Alfama")).toBeLessThan(block.indexOf("Hoshinoya"));
    expect(staysForPrompt([], "Lisbon")).toBe("");
    // Mostly rentals: say so.
    const rentals = groupStays([stay("r1", "Airbnb in Paris", "Paris", "2024-03-04"), stay("r2", "Vrbo in Lisbon", "Lisbon", "2025-01-02")]);
    expect(staysForPrompt(rentals, "Kyoto")).toContain("They often rent whole places");
  });

  it("takes hotels found in photos as their own source", () => {
    expect(SIGNAL_SOURCES).toContain("photos");
    const s = TasteSignalSchema.parse({ source: "photos", ref: "photos:ChIJ123:2024-11", kind: "stay", name: "Hoshinoya Kyoto", city: "Kyoto", countryCode: "jp", date: "2024-11-20" });
    expect(s).toMatchObject({ source: "photos", countryCode: "JP" });
  });
});

describe("where someone slept, from photos at night", () => {
  // Kyoto is UTC+9, about 135°E: its solar hour is UTC + 9.
  const kyoto = { lat: 35.0116, lng: 135.7681 };
  const at = (utc: string) => Date.parse(utc);

  it("reads the hour where the photo was taken, and gives mornings to the night before", () => {
    expect(nightOf(at("2024-11-20T13:30:00Z"), kyoto.lng)).toEqual({ night: "2024-11-20", when: "evening" }); // 10:30pm there
    expect(nightOf(at("2024-11-20T22:00:00Z"), kyoto.lng)).toEqual({ night: "2024-11-20", when: "morning" }); // 7am on the 21st
    expect(nightOf(at("2024-11-21T03:00:00Z"), kyoto.lng)).toBeNull(); // noon
    // Lisbon, near 0°: the hour is about UTC.
    expect(nightOf(at("2025-05-11T23:10:00Z"), -9.14)).toEqual({ night: "2025-05-11", when: "evening" });
  });

  it("finds the spot of several nights, or of an evening and the morning after, but not a bar visited once", () => {
    const hotel = { lat: 35.0151, lng: 135.6773 };
    const near = (d: number) => ({ lat: hotel.lat + d, lng: hotel.lng });
    const spots = sleepSpots([
      { night: "2024-11-20", ...near(0.0002), when: "evening" },
      { night: "2024-11-20", ...near(-0.0001), when: "morning" },
      { night: "2024-11-21", ...near(0.0003), when: "morning" },
      { night: "2024-11-21", lat: 35.0037, lng: 135.7788, when: "evening" }, // a bar in Gion, once
    ]);
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ first: "2024-11-20", nights: 2 });
    expect(Math.abs(spots[0]!.lat - hotel.lat)).toBeLessThan(0.001);
    // One evening photo alone isn't enough to say where they slept.
    expect(sleepSpots([{ night: "2024-11-20", ...hotel, when: "evening" }])).toEqual([]);
    expect(sleepSpots([{ night: "2024-11-20", ...hotel, when: "evening" }, { night: "2024-11-20", ...near(0.0004), when: "morning" }])).toHaveLength(1);
  });
});
