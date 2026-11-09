import { describe, expect, it } from "vitest";
import { mapCentre, publicItinerary, type Itinerary } from "../src";

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

describe("where the map of places you've been faces first", () => {
  it("faces the side of the world with most of the trips", () => {
    expect(mapCentre([])).toBeNull();
    // Europe four times over, Kyoto once: the globe faces Europe, Kyoto round the back.
    const europe = mapCentre([
      { lat: 38.72, lng: -9.14, weight: 2 },
      { lat: 48.86, lng: 2.35 },
      { lat: 43.32, lng: -1.98 },
      { lat: 35.01, lng: 135.77 },
    ])!;
    expect(europe.lat).toBeGreaterThan(38);
    expect(europe.lat).toBeLessThan(48);
    expect(europe.lng).toBeGreaterThan(-9);
    expect(europe.lng).toBeLessThan(3);
    // One place: right on it.
    expect(mapCentre([{ lat: -33.92, lng: 18.42 }])).toEqual({ lat: -33.92, lng: 18.42 });
    // Either side of the date line stays in the Pacific.
    const pacific = mapCentre([
      { lat: -17.7, lng: 178.1 },
      { lat: -13.8, lng: -171.8 },
    ])!;
    expect(Math.abs(pacific.lng)).toBeGreaterThan(170);
  });
});
