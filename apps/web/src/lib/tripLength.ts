import { TRIP_LENGTH_TOOL, TripLengthSchema, buildTripLengthPrompt, type TripLength, type TripMode } from "@travel/core";
import { callTool } from "./claude";
import { asPlaceName, readFact, words, writeFact } from "./destinationFacts";

/** The recommended length for a destination (packages/core/src/tripLength.ts), asked once and cached. */

const cacheKey = (destination: string, mode: TripMode) => `triplen1:${mode}:${words(destination)}`;

/** The cached answer, or null. Never asks the model. */
export async function readIdealDays(destination: string, mode: TripMode): Promise<TripLength | null> {
  if (words(destination).length < 2) return null;
  return readFact(cacheKey(destination, mode), TripLengthSchema);
}

/** The recommended length, from the cache or asked now. Never throws: null when it can't be had. */
export async function idealDays(destination: string, mode: TripMode, deadline = Date.now() + 25_000): Promise<TripLength | null> {
  try {
    const cached = await readIdealDays(destination, mode).catch(() => null);
    if (cached) return cached;
    const place = asPlaceName(destination);
    if (place.length < 2) return null;
    const { input } = await callTool(buildTripLengthPrompt(place, mode), TRIP_LENGTH_TOOL, 400, { fast: true, deadline });
    const a = (input ?? {}) as { min_days?: unknown; max_days?: unknown; note?: unknown };
    const ok = TripLengthSchema.safeParse({ min: a.min_days, max: a.max_days, note: a.note });
    if (!ok.success) {
      console.error("[triplength] unusable answer for", place, JSON.stringify(input).slice(0, 200));
      return null;
    }
    await writeFact(cacheKey(destination, mode), ok.data);
    return ok.data;
  } catch (e) {
    console.error("[triplength]", destination, (e as Error).message);
    return null;
  }
}
