import { describe, expect, it } from "vitest";
import { AIRBNB_ICONS, airbnbSearchUrl, dateSpan, guestsFor, guestsText, stayWindows } from "../src";

const days = (...cities: (string | undefined)[]) => cities.map((city) => ({ label: "", theme: "", city, stops: [] }));
const trip = (o: { destination: string; startDate?: string | null; mode?: "single" | "multi"; cities: (string | undefined)[] }) => ({
  destination: o.destination,
  request: { startDate: o.startDate ?? null, mode: o.mode ?? "single" },
  itinerary: { mode: o.mode ?? "single", days: days(...o.cities) },
});
const today = "2026-11-07";

describe("where and when to book a stay", () => {
  it("covers a one-place trip, checking out the morning after the last day", () => {
    expect(stayWindows(trip({ destination: "Lisbon", startDate: "2026-12-04", cities: [undefined, undefined, undefined] }), { today })).toEqual([
      { place: "Lisbon", city: "Lisbon", nights: 3, checkin: "2026-12-04", checkout: "2026-12-07" },
    ]);
  });

  it("leaves the dates out when the trip has none, or they've passed", () => {
    const noDates = stayWindows(trip({ destination: "Lisbon", cities: [undefined, undefined] }), { today });
    expect(noDates).toEqual([{ place: "Lisbon", city: "Lisbon", nights: 2 }]);
    expect(stayWindows(trip({ destination: "Lisbon", startDate: "2026-01-10", cities: [undefined] }), { today })[0]).not.toHaveProperty("checkin");
    // A date picked elsewhere (the calendar) stands in for a missing start date.
    expect(stayWindows(trip({ destination: "Lisbon", cities: [undefined] }), { today, startDate: "2026-12-01" })[0]).toMatchObject({ checkin: "2026-12-01", checkout: "2026-12-02" });
  });

  it("gives each town on a multi-city trip its own nights, in order", () => {
    const w = stayWindows(trip({ destination: "Egypt", mode: "multi", startDate: "2026-12-04", cities: ["Cairo", "Cairo", "Cairo", "Luxor", "Luxor", "Aswan", "Cairo"] }), { today });
    expect(w.map((x) => [x.place, x.checkin, x.checkout, x.nights])).toEqual([
      ["Cairo, Egypt", "2026-12-04", "2026-12-07", 3],
      ["Luxor, Egypt", "2026-12-07", "2026-12-09", 2],
      ["Aswan, Egypt", "2026-12-09", "2026-12-10", 1],
      ["Cairo, Egypt", "2026-12-10", "2026-12-11", 1], // back in Cairo: a second stay
    ]);
  });

  it("keeps a day without a town with the town before it", () => {
    const w = stayWindows(trip({ destination: "Japan", mode: "multi", cities: ["Tokyo", undefined, "Kyoto"] }), { today });
    expect(w.map((x) => [x.city, x.nights])).toEqual([
      ["Tokyo", 2],
      ["Kyoto", 1],
    ]);
  });
});

describe("guests", () => {
  it("counts the party, friends planning together, and a family's children", () => {
    expect(guestsFor({ party: "Solo" })).toEqual({ adults: 1, children: 0 });
    expect(guestsFor({ party: "Couple", with: [] })).toEqual({ adults: 2, children: 0 });
    expect(guestsFor({ party: "Family with kids" })).toEqual({ adults: 2, children: 2 });
    expect(guestsFor({ party: "Group of friends", with: ["ana", "bo", "cy", "di", "ed"] })).toEqual({ adults: 6, children: 0 });
    expect(guestsText({ adults: 1, children: 0 })).toBe("1 guest");
    expect(guestsText({ adults: 2, children: 2 })).toBe("2 adults, 2 kids");
  });
});

describe("the Airbnb search", () => {
  it("writes the place the way Airbnb does, with dates and guests", () => {
    expect(airbnbSearchUrl({ place: "Lisbon", checkin: "2026-12-04", checkout: "2026-12-07" }, { adults: 2, children: 0 })).toBe(
      "https://www.airbnb.com/s/Lisbon/homes?checkin=2026-12-04&checkout=2026-12-07&adults=2",
    );
    expect(airbnbSearchUrl({ place: "Luxor, Egypt", checkin: "2026-12-07", checkout: "2026-12-09" }, { adults: 2, children: 2 })).toBe(
      "https://www.airbnb.com/s/Luxor--Egypt/homes?checkin=2026-12-07&checkout=2026-12-09&adults=2&children=2",
    );
    expect(airbnbSearchUrl({ place: "Mexico City" }, { adults: 2, children: 0 })).toBe("https://www.airbnb.com/s/Mexico-City/homes?adults=2");
    expect(airbnbSearchUrl({ place: "Positano, the Amalfi Coast" }, { adults: 1, children: 0 })).toBe("https://www.airbnb.com/s/Positano--Amalfi-Coast/homes?adults=1");
    expect(airbnbSearchUrl({ place: "São Paulo" }, { adults: 1, children: 0 })).toBe("https://www.airbnb.com/s/S%C3%A3o-Paulo/homes?adults=1");
    // Nothing typed can reach past the path.
    expect(airbnbSearchUrl({ place: "Rome/../../x?y#z" }, { adults: 1, children: 0 })).toMatch(/^https:\/\/www\.airbnb\.com\/s\/Rome-\.\.-\.\.-x-y-z\/homes\?adults=1$/);
  });

  it("labels the dates briefly", () => {
    expect(dateSpan("2026-12-04", "2026-12-07")).toBe("Dec 4–7");
    expect(dateSpan("2026-11-29", "2026-12-02")).toBe("Nov 29 – Dec 2");
  });

  it("loads Airbnb's icon from Airbnb", () => {
    expect(AIRBNB_ICONS.every((u) => /^https:\/\/(a0\.muscache\.com|www\.airbnb\.com)\//.test(u))).toBe(true);
  });
});
