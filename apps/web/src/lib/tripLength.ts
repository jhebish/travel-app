import { TRIP_LENGTH_TOOL, TripLengthSchema, buildTripLengthPrompt, type TripLength, type TripMode } from "@travel/core";
import { callTool } from "./claude";
import { supabaseAdmin } from "./supabase/server";

/**
 * The recommended length for a destination (packages/core/src/tripLength.ts): asked once with the
 * fast model and kept for everyone in places_cache, so Lisbon gets the same answer every time and
 * only the first trip there waits for it.
 */

/** What was typed, normalized: "Lisbon, Portugal" and "lisbon portugal" share an answer. */
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const cacheKey = (destination: string, mode: TripMode) => `triplen1:${mode}:${words(destination)}`;

/** A place name safe to quote in a prompt: one line, no quotes, brackets or control characters. */
const asPlaceName = (s: string) =>
  s
    .replace(/[\p{Cc}"“”„«»`<>{}[\]\\]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/** Typical lengths don't change much: ask again twice a year. */
const FRESH_MS = 182 * 24 * 3600_000;

/** The cached answer, or null. Never asks the model. */
export async function readIdealDays(destination: string, mode: TripMode): Promise<TripLength | null> {
  if (words(destination).length < 2) return null;
  const { data } = await supabaseAdmin().from("places_cache").select("data, fetched_at").eq("key", cacheKey(destination, mode)).maybeSingle();
  if (!data || Date.now() - new Date(data.fetched_at as string).getTime() > FRESH_MS) return null;
  const ok = TripLengthSchema.safeParse(data.data);
  return ok.success ? ok.data : null;
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
    const { error } = await supabaseAdmin()
      .from("places_cache")
      .upsert({ key: cacheKey(destination, mode), data: ok.data, fetched_at: new Date().toISOString() });
    if (error) console.error("[triplength] cache write failed", error.code);
    return ok.data;
  } catch (e) {
    console.error("[triplength]", destination, (e as Error).message);
    return null;
  }
}
