import { describe, expect, it } from "vitest";
import { ItinerarySchema, TripLengthSchema, buildTripLengthPrompt, fitText, lengthFit, rangeText } from "../src";

describe("recommended trip length", () => {
  const lisbon = { min: 3, max: 4, note: "Two days for the old town and Belém, a third for Sintra." };

  it("says whether the planned days are short, right or long", () => {
    expect(lengthFit(2, lisbon)).toBe("short");
    expect(lengthFit(3, lisbon)).toBe("right");
    expect(lengthFit(4, lisbon)).toBe("right");
    expect(lengthFit(6, lisbon)).toBe("long");
    expect(fitText(2, lisbon, "Lisbon")).toBe("Your 2 days are tight for Lisbon.");
    expect(fitText(1, lisbon, "Lisbon")).toBe("Your 1 day is tight for Lisbon.");
    expect(fitText(3, lisbon, "Lisbon")).toBe("Your 3 days fit.");
    expect(fitText(6, lisbon, "Lisbon")).toMatch(/^Your 6 days are more than most people need/);
    expect(rangeText(lisbon)).toBe("3–4 days");
    expect(rangeText({ min: 1, max: 1 })).toBe("1 day");
  });

  it("checks the model's answer: numbers as text, a reversed range, a long note", () => {
    expect(TripLengthSchema.parse({ min: "4", max: "3", note: "x".repeat(300) })).toEqual({ min: 3, max: 4, note: "x".repeat(160) });
    expect(TripLengthSchema.safeParse({ min: 0, max: 3 }).success).toBe(false);
    expect(TripLengthSchema.safeParse({ min: 2, max: 99 }).success).toBe(false);
  });

  it("is kept on the trip, and a broken one doesn't break the trip", () => {
    const base = { title: "Lisbon", days: [{ label: "Day 1", theme: "", stops: [{ name: "Time Out Market", source: "press" }] }] };
    expect(ItinerarySchema.parse({ ...base, idealDays: lisbon }).idealDays).toEqual(lisbon);
    expect(ItinerarySchema.parse({ ...base, idealDays: { min: "nope" } }).idealDays).toBeUndefined();
    expect(ItinerarySchema.parse(base).idealDays).toBeUndefined();
  });

  it("asks without saying how long the traveler picked", () => {
    const one = buildTripLengthPrompt("Lisbon", "single");
    expect(one).toContain("a first visit to Lisbon");
    const multi = buildTripLengthPrompt("Egypt", "multi");
    expect(multi).toContain("several stops around Egypt");
    // The only numbers are the examples' ("one day", "two weeks", "140 characters"), never the trip's.
    expect(one.match(/\d+/g)).toEqual(["140"]);
  });
});
