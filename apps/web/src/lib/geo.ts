import { DESTINATIONS, cityKey } from "@travel/core";
import { z } from "zod";
import { readFact, words, writeFact } from "./destinationFacts";
import { locateCity } from "./places";

const Point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
/** A name Google couldn't place, not asked again until `until` (ms). */
const Unplaced = z.object({ none: z.literal(true), until: z.number() });
const Kept = z.union([Point, Unplaced]);
/** Cities don't move: an answer is good for years. */
const GEO_FRESH_MS = 5 * 365 * 24 * 3600_000;
/** A name that couldn't be placed is tried again after this long. */
const UNPLACED_MS = 60 * 24 * 3600_000;

/** A city's pin, "none" when it can't be placed, or "later" when it wasn't looked up this time. */
export type CityCentre = { lat: number; lng: number } | "none" | "later";

/**
 * Where a city (or region) is, for maps of places someone has been: a Pylos destination's own
 * pin, else the answer kept from an earlier lookup, else Google's (then kept for everyone,
 * names it can't place included, so they aren't paid for on every visit). `mayLookUp` is
 * asked before each Google lookup, to cap them per request.
 */
export async function cityCentre(city: string, countryCode: string, mayLookUp: () => boolean = () => true): Promise<CityCentre> {
  const cc = countryCode.toUpperCase();
  const featured = DESTINATIONS.find((d) => d.countryCode === cc && cityKey(d.name) === cityKey(city));
  if (featured) return { lat: featured.lat, lng: featured.lng };
  const key = `geo1:${cc}:${words(city)}`;
  const kept = await readFact(key, Kept, GEO_FRESH_MS).catch(() => null);
  if (kept && !("none" in kept)) return kept;
  if (kept && kept.until > Date.now()) return "none";
  if (!mayLookUp()) return "later";
  try {
    const found = await locateCity(city, cc);
    await writeFact(key, found ?? { none: true, until: Date.now() + UNPLACED_MS }).catch(() => {});
    return found ?? "none";
  } catch {
    return "later";
  }
}
