import { describe, expect, it } from "vitest";
import { publicItinerary, type Itinerary } from "../src";

const itinerary: Itinerary = {
  title: "Two days in Lisbon",
  summary: "",
  forYou: "Built around the tascas you rated in Lisbon.",
  notes: ["Lisbon is welcoming; Príncipe Real is the heart of LGBTQ+ nightlife.", "Trams 28 and 12 get crowded: go early."],
  replaced: [],
  days: [
    {
      label: "Day 1",
      theme: "Alfama",
      stops: [{ time: "09:00", name: "Miradouro de Santa Luzia", neighborhood: "Alfama", why: "", localTip: "", source: "locals" }],
    },
  ],
  hotels: [],
};

describe("publicItinerary and About-you answers", () => {
  it("leaves the notes out when they were written for an LGBTQ+ traveler", () => {
    const pub = publicItinerary(itinerary, { about: ["LGBTQ+ traveler", "Eats halal"] });
    expect(pub.notes).toEqual([]);
    expect(pub.days).toHaveLength(1);
    expect(itinerary.notes).toHaveLength(2); // the owner's copy is untouched
  });

  it("keeps the notes otherwise", () => {
    expect(publicItinerary(itinerary, { about: ["Eats halal", "Vegetarian"] }).notes).toEqual(itinerary.notes);
    expect(publicItinerary(itinerary, { about: [] }).notes).toEqual(itinerary.notes);
    expect(publicItinerary(itinerary).notes).toEqual(itinerary.notes);
    expect(publicItinerary(itinerary, null).notes).toEqual(itinerary.notes);
  });

  it("tolerates old or odd requests, erring on the private side", () => {
    expect(publicItinerary(itinerary, { about: null }).notes).toEqual(itinerary.notes);
    expect(publicItinerary(itinerary, {} as { about?: string[] }).notes).toEqual(itinerary.notes);
    expect(publicItinerary(itinerary, { about: "LGBTQ+ traveler" } as unknown as { about: string[] }).notes).toEqual([]);
  });

  it("still strips the owner's For you line", () => {
    expect(publicItinerary(itinerary, { about: ["LGBTQ+ traveler"] }).forYou).toBe("");
  });
});
