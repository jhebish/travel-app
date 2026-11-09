import { describe, expect, it } from "vitest";
import { foldPlace, localSuggestions, mergeSuggestions, suggestKind, type PlaceSuggestion } from "../src";

describe("guessing the destination as it's typed", () => {
  it("finds Pylos places by the start of a name or a word in it, accents aside", () => {
    expect(localSuggestions("lis", { mode: "single" })[0]).toMatchObject({ label: "Lisbon, Portugal", kind: "city", reason: "featured", key: "lisbon" });
    expect(localSuggestions("city", { mode: "single" }).map((s) => s.name)).toContain("Mexico City");
    expect(foldPlace("São Paulo")).toBe("sao paulo");
    expect(localSuggestions("", { mode: "single" })).toEqual([]);
  });

  it("puts their picks and places they've been first", () => {
    // Of the places starting "ca", the shortest name comes first, unless one is a pick.
    expect(localSuggestions("ca", { mode: "single" })[0]).toMatchObject({ key: "cadiz" });
    expect(localSuggestions("ca", { mode: "single", forYou: ["cape-town"] })[0]).toMatchObject({ key: "cape-town", reason: "for-you" });
    const been = localSuggestions("san seb", { mode: "single", been: [{ city: "San Sebastián", countryCode: "ES" }] });
    expect(been[0]).toMatchObject({ label: "San Sebastián, Spain", reason: "been" });
  });

  it("offers countries, first when the trip has several stops", () => {
    const multi = localSuggestions("ja", { mode: "multi" });
    expect(multi[0]).toMatchObject({ label: "Japan", kind: "country" });
    // One place: a city named like what's typed beats the country, which beats cities found only by their country.
    const single = localSuggestions("ca", { mode: "single" }).map((s) => s.label);
    expect(single.indexOf("Cádiz, Spain")).toBeLessThan(single.indexOf("Canada"));
    const port = localSuggestions("port", { mode: "single" }).map((s) => s.label);
    expect(port.indexOf("Portugal")).toBeLessThan(port.indexOf("Lisbon, Portugal"));
    expect(port).toContain("Lisbon, Portugal");
    expect(localSuggestions("a", { mode: "single" }).length).toBeLessThanOrEqual(6);
  });

  it("merges in the map's suggestions without repeats", () => {
    const local = localSuggestions("lisb", { mode: "single" });
    const remote: PlaceSuggestion[] = [
      { label: "Lisbon, Portugal", name: "Lisbon", sub: "Portugal", kind: "city" },
      { label: "Lisbon, ME, USA", name: "Lisbon", sub: "ME, USA", kind: "city" },
    ];
    const merged = mergeSuggestions(local, remote);
    expect(merged.filter((s) => s.label === "Lisbon, Portugal")).toHaveLength(1);
    expect(merged[0]!.reason).toBe("featured");
    expect(merged.map((s) => s.label)).toContain("Lisbon, ME, USA");
    expect(suggestKind(["country", "political"])).toBe("country");
    expect(suggestKind(["locality", "political"])).toBe("city");
    expect(suggestKind(["administrative_area_level_1", "political"])).toBe("region");
  });
});
