import { z } from "zod";
import { isCountryCode } from "./countries";
import { salvage } from "./schemas";
import type { SignalKind } from "./taste";

/**
 * Quick trip logging: type a city, then tick the places you loved from a ready-made list of its
 * best-known stays, restaurants, bars and sights. The list is written once per city and cached.
 */
export const PICK_KINDS = ["stay", "food", "drink", "coffee", "nightlife", "sight", "activity", "shop"] as const satisfies readonly SignalKind[];
export type PickKind = (typeof PICK_KINDS)[number];

/** How the list is grouped on screen, in order. */
export const PICK_GROUPS: { label: string; kinds: PickKind[] }[] = [
  { label: "Where you stayed", kinds: ["stay"] },
  { label: "Where you ate", kinds: ["food"] },
  { label: "Drinks and coffee", kinds: ["drink", "coffee", "nightlife"] },
  { label: "What you saw and did", kinds: ["sight", "activity", "shop"] },
];

const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : ""), z.string());

export const CityPickSchema = z.object({
  kind: z.enum(PICK_KINDS),
  name: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 120) : v), z.string().min(1)),
  /** What it is and where, e.g. "Old-school tasca · Alfama". */
  note: text(80).default(""),
});
export type CityPick = z.infer<typeof CityPickSchema>;

export const CityPicksSchema = z
  .object({
    found: z.boolean().catch(true).default(true),
    city: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 80) : v), z.string().min(1)),
    countryCode: z.preprocess(
      (v) => (typeof v === "string" && isCountryCode(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null),
      z.string().nullable(),
    ),
    picks: salvage(CityPickSchema, 0, 48).catch([]),
  })
  .transform((r) => {
    const seen = new Set<string>();
    const picks = r.picks.filter((p) => {
      const k = p.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...r, picks };
  });
export type CityPicks = z.infer<typeof CityPicksSchema>;

export const CITY_PICKS_TOOL = {
  name: "submit_places",
  description: "Submit the place, resolved, and the list of its best-known places for a visitor to tick.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "False if this isn't a real town, city, island or region you know." },
      city: { type: "string", description: "The place's usual English name, e.g. \"Lisbon\", \"Amalfi Coast\"." },
      countryCode: { type: "string", description: "ISO 3166-1 alpha-2 country code, e.g. \"PT\"." },
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...PICK_KINDS] },
            name: { type: "string", description: "The place's name as people know it." },
            note: { type: "string", description: "What it is and where, under 7 words, e.g. \"Old-school tasca · Alfama\"." },
          },
          required: ["kind", "name", "note"],
        },
      },
    },
    required: ["found", "city", "countryCode", "picks"],
  },
} as const;

export function buildCityPicksPrompt(city: string): string {
  return `A traveler is logging a past trip to "${city.replace(/["\n\r]/g, " ").trim()}" and will tick the places they loved.

List the places they are most likely to have been, so most visitors recognize several:
- First resolve the place: its usual English name and country code. If it isn't a real place, set "found" to false and leave "picks" empty.
- Then 32 places that have been around for years and are still well known: famous names first, then places locals love.
- Spread them: 6 stays (from a good hostel or guesthouse to the grand hotel, including a design or boutique hotel), 9 restaurants (institutions, local favorites, one fine-dining, street food or a market stall), 4 bars, 3 cafés, 2 nightlife, 5 sights (landmarks, museums, viewpoints, beaches), 3 things to do (tours, hikes, day trips, classes) and 2 shops or markets. For a region or island, spread them across its towns.
- "note": what it is and where, under 7 words.
- Only real places you are confident about. No duplicates.

Call submit_places.`;
}
