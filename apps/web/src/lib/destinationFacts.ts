import type { ZodType, ZodTypeDef } from "zod";
import { supabaseAdmin } from "./supabase/server";

/**
 * Facts about a destination that hardly change (how long to stay, what hotels cost): asked of the
 * fast model once and kept for everyone in places_cache, so every trip to Lisbon gets the same answer
 * and only the first one waits for it.
 */

/** What was typed, normalized: "Lisbon, Portugal" and "lisbon portugal" share an answer. */
export const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A place name safe to quote in a prompt: one line, no quotes, brackets or control characters. */
export const asPlaceName = (s: string) =>
  s
    .replace(/[\p{Cc}"“”„«»`<>{}[\]\\]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/** Twice a year is often enough to ask again. */
export const FACT_FRESH_MS = 182 * 24 * 3600_000;

/** The cached fact if it's fresh and still valid, else null. */
export async function readFact<T>(key: string, schema: ZodType<T, ZodTypeDef, unknown>, freshMs = FACT_FRESH_MS): Promise<T | null> {
  const { data } = await supabaseAdmin().from("places_cache").select("data, fetched_at").eq("key", key).maybeSingle();
  if (!data || Date.now() - new Date(data.fetched_at as string).getTime() > freshMs) return null;
  const ok = schema.safeParse(data.data);
  return ok.success ? ok.data : null;
}

export async function writeFact(key: string, value: unknown): Promise<void> {
  const { error } = await supabaseAdmin().from("places_cache").upsert({ key, data: value, fetched_at: new Date().toISOString() });
  if (error) console.error("[facts] cache write failed", key, error.code);
}
