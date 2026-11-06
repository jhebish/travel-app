import { CITY_PICKS_TOOL, CityPicksSchema, buildCityPicksPrompt, cityKey, type CityPicks } from "@travel/core";
import type { Ctx } from "./auth";
import { callTool } from "./claude";
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase/server";
import { rateLimit } from "./tripAccess";

/** A city's list changes slowly: keep it for six months, shared by everyone. */
const KEEP_MS = 180 * 864e5;
const keyFor = (city: string) => `citypicks1:${cityKey(city)}`;

async function readCached(key: string): Promise<CityPicks | null> {
  const { data } = await supabaseAdmin().from("places_cache").select("data, fetched_at").eq("key", key).maybeSingle();
  if (!data || Date.now() - new Date(data.fetched_at).getTime() > KEEP_MS) return null;
  const ok = CityPicksSchema.safeParse(data.data);
  return ok.success ? ok.data : null;
}

/**
 * The best-known stays, restaurants, bars and sights in a city, for "tick what you loved".
 * Written once per city by the fast model, then served from the cache.
 */
export async function cityPicks(ctx: Ctx, city: string): Promise<CityPicks> {
  if (!cityKey(city)) throw new HttpError(400, "Type the city you went to.");
  const key = keyFor(city);
  const hit = await readCached(key);
  if (hit) return hit;

  await rateLimit(ctx, "extract", 30, "That's a lot of new cities this hour. Try again a little later.");
  // Two halves at once: stays, food and cafés; then drinks, sights and things to do.
  const half = async (part: 0 | 1): Promise<CityPicks | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { input } = await callTool(buildCityPicksPrompt(city, part), CITY_PICKS_TOOL, 2500, { fast: true }).catch(() => ({ input: null }));
      const r = CityPicksSchema.safeParse(input);
      if (r.success && (!r.data.found || r.data.picks.length >= 5)) return r.data;
    }
    return null;
  };
  const [a, b] = await Promise.all([half(0), half(1)]);
  const first = a ?? b;
  if (!first) throw new HttpError(502, "We couldn't load places for that city just now. Try again.", "bad_output");
  if (!first.found || (a && !a.found && b && !b.found)) return { ...first, found: false, picks: [] };
  const merged = CityPicksSchema.parse({ ...first, picks: [...(a?.found ? a.picks : []), ...(b?.found ? b.picks : [])] });
  const parsed: CityPicks = { ...merged, countryCode: a?.countryCode ?? b?.countryCode ?? null };
  if (parsed.picks.length < 8) throw new HttpError(502, "We couldn't load places for that city just now. Try again.", "bad_output");

  // Cache under what they typed and under the proper name ("NYC" and "New York").
  const now = new Date().toISOString();
  const rows = [...new Set([key, keyFor(parsed.city)])].map((k) => ({ key: k, data: parsed, fetched_at: now }));
  const { error } = await supabaseAdmin().from("places_cache").upsert(rows);
  if (error) console.error("city picks cache write failed", error.code);
  return parsed;
}
