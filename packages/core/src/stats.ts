/**
 * Travel stats and city keys: plain functions with no zod, so the profile page can count someone's
 * countries in the browser without downloading the schemas (community.ts re-exports these).
 */

/** "Lisbon, Portugal" → "lisbon"; "São Paulo" → "sao paulo". Used to group trips by city. */
export function cityKey(destination: string): string {
  return destination
    .split(",")[0]!
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 '-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TravelLevel {
  name: string;
  min: number; // countries needed
}

export interface TravelStats {
  countries: number;
  cities: number;
  trips: number;
  level: TravelLevel;
  next: { level: TravelLevel; countriesToGo: number } | null;
}

export const TRAVEL_LEVELS: TravelLevel[] = [
  { name: "Homebody", min: 0 },
  { name: "Day-tripper", min: 1 },
  { name: "Explorer", min: 3 },
  { name: "Voyager", min: 8 },
  { name: "Globetrotter", min: 15 },
  { name: "Nomad", min: 30 },
  { name: "Legend", min: 50 },
];

/** Distinct countries and cities from someone's places. Cities are counted per country. */
export function travelStats(places: { city: string; countryCode: string }[]): TravelStats {
  const countries = new Set(places.map((p) => p.countryCode.toUpperCase()));
  const cities = new Set(places.map((p) => `${p.countryCode.toUpperCase()}:${cityKey(p.city)}`));
  const n = countries.size;
  let idx = 0;
  for (let i = 0; i < TRAVEL_LEVELS.length; i++) if (n >= TRAVEL_LEVELS[i]!.min) idx = i;
  const nextLevel = TRAVEL_LEVELS[idx + 1];
  return {
    countries: n,
    cities: cities.size,
    trips: places.length,
    level: TRAVEL_LEVELS[idx]!,
    next: nextLevel ? { level: nextLevel, countriesToGo: nextLevel.min - n } : null,
  };
}
