import { describe, expect, it } from "vitest";
import { COIN_EMBLEMS, cityCoins, coinLegend, dayPart, dayPartHeads, dayTitle, romanNumeral, travelStats } from "../src";

describe("day numerals", () => {
  it("writes Roman numerals", () => {
    expect([1, 2, 3, 4, 5, 9, 14, 19, 21, 40].map(romanNumeral)).toEqual(["I", "II", "III", "IV", "V", "IX", "XIV", "XIX", "XXI", "XL"]);
    expect(romanNumeral(0)).toBe("0");
  });
  it("retitles stored day labels and leaves other labels alone", () => {
    expect(dayTitle("Day 1")).toBe("Day I");
    expect(dayTitle("day 12")).toBe("Day XII");
    expect(dayTitle("Arrival")).toBe("Arrival");
    expect(dayTitle("Day 2 in Porto")).toBe("Day 2 in Porto");
    expect(dayTitle("")).toBe("");
  });
});

describe("dawn, midday, dusk", () => {
  it("sorts 24h times into parts of the day", () => {
    expect(dayPart("09:30")).toBe("dawn");
    expect(dayPart("11:59")).toBe("dawn");
    expect(dayPart("12:00")).toBe("midday");
    expect(dayPart("16:45")).toBe("midday");
    expect(dayPart("17:00")).toBe("dusk");
    expect(dayPart("23:30")).toBe("dusk");
    expect(dayPart("01:00")).toBe("dusk");
    expect(dayPart("")).toBeNull();
    expect(dayPart("Morning")).toBeNull();
    expect(dayPart("25:00")).toBeNull();
  });
  it("heads each part once, and keeps a stop with no time in the part before it", () => {
    const heads = dayPartHeads(["09:00", "10:30", "", "13:00", "15:00", "19:30", "00:30"]);
    expect(heads.map((h) => h.head)).toEqual(["dawn", null, null, "midday", null, "dusk", null]);
    expect(heads.map((h) => h.part)).toEqual(["dawn", "dawn", "dawn", "midday", "midday", "dusk", "dusk"]);
    expect(dayPartHeads(["", ""]).every((h) => h.part === null && h.head === null)).toBe(true);
  });
});

describe("city coins", () => {
  it("abbreviates a city the way a coin would", () => {
    expect(coinLegend("Lisbon")).toBe("LIS");
    expect(coinLegend("New York")).toBe("NY");
    expect(coinLegend("Rio de Janeiro")).toBe("RDJ");
    expect(coinLegend("São Paulo, Brazil")).toBe("SP");
    expect(coinLegend("Xi'an")).toBe("XA");
    expect(coinLegend("Oaxaca")).toBe("OAX");
  });
  it("strikes one coin per city, newest first, with metal by visits", () => {
    const coins = cityCoins([
      { id: "a", city: "Lisbon", countryCode: "PT", year: 2019, month: 5 },
      { id: "b", city: "lisbon", countryCode: "pt", year: 2023, month: 9 },
      { id: "c", city: "Kyoto", countryCode: "JP", year: 2024, month: null },
      { id: "d", city: "Lisbon, Portugal", countryCode: "PT", year: 2021, month: 1 },
      { id: "e", city: "Cairo", countryCode: "EG", year: null, month: null },
      { id: "f", city: "Porto", countryCode: "PT", year: 2023, month: 9 },
      { id: "g", city: "Porto", countryCode: "PT", year: 2022, month: 2 },
    ]);
    expect(coins.map((c) => c.city)).toEqual(["Kyoto", "Lisbon", "Porto", "Cairo"]);
    const lisbon = coins[1]!;
    expect(lisbon).toMatchObject({ visits: 3, metal: "gold", firstYear: 2019, lastYear: 2023, latestId: "b", legend: "LIS", countryCode: "PT" });
    expect(coins[2]).toMatchObject({ visits: 2, metal: "silver", latestId: "f" });
    expect(coins[0]).toMatchObject({ visits: 1, metal: "bronze" });
    expect(coins[3]).toMatchObject({ firstYear: null, lastYear: null });
    for (const c of coins) {
      expect(COIN_EMBLEMS).toContain(c.emblem);
      expect(Math.abs(c.turn)).toBeLessThanOrEqual(8);
    }
    // A city keeps its emblem however it is logged.
    expect(cityCoins([{ id: "z", city: "LISBON", countryCode: "PT", year: 2001 }])[0]!.emblem).toBe(lisbon.emblem);
  });
});

describe("traveler levels", () => {
  const countries = (n: number) => Array.from({ length: n }, (_, i) => ({ city: `City ${i}`, countryCode: `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}` }));
  it("ends the ladder in Wayfarer, Voyager, Navigator, Odyssean", () => {
    expect([0, 1, 3, 8, 15, 30, 50].map((n) => travelStats(countries(n)).level.name)).toEqual(["Homebody", "Day-tripper", "Explorer", "Wayfarer", "Voyager", "Navigator", "Odyssean"]);
    expect(travelStats(countries(50)).next).toBeNull();
  });
});
