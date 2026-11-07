import { hotNow, regionPolicy, type NightPulse } from "@travel/core";
import { waitUntil } from "@vercel/functions";
import { getCtx } from "@/lib/auth";
import { HttpError, handler, json } from "@/lib/http";
import { nightPulse, readPulse } from "@/lib/nightPulse";
import { rateLimit } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The research keeps going after the response (waitUntil), up to this.
export const maxDuration = 120;

const cityOf = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

/** What travelers see of a city's pulse: the places, whether each is hot now, and the sources. */
function view(p: NightPulse) {
  const now = new Date();
  return {
    city: p.city,
    updated: p.fetchedAt,
    // With earlier lists, a place first seen this month is new (on a city's first list, everything is).
    hasHistory: p.history.length > 0,
    spots: p.spots
      .filter((s) => s.place?.placeId)
      .map((s) => ({
        name: s.name,
        neighborhood: s.neighborhood,
        type: s.type,
        style: s.style,
        when: s.when,
        door: s.door,
        why: s.why,
        score: s.score,
        hot: hotNow(s.evidence, now),
        sources: s.evidence.map((e) => ({ source: e.source, url: e.url, date: e.date })),
        mapsUrl: s.place?.mapsUrl,
        since: s.firstSeen,
      })),
  };
}

/** A city's bars and clubs of the moment, from the cache (never researched here). ?city=Lisbon */
export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  if (!ctx.user) throw new HttpError(401, "Sign in to see this.");
  const city = cityOf(new URL(req.url).searchParams.get("city"));
  if (city.length < 2) throw new HttpError(400, "Which city?");
  // Not for Israel, nor for Jerusalem, whose trips use only Palestinian businesses (region.ts).
  if (regionPolicy(city) !== "ok") return json({ pulse: null });
  const p = await readPulse(city);
  return json({ pulse: p ? view(p) : null });
});

/**
 * Get a city's pulse ready: answers at once, and researches in the background when there isn't a
 * fresh one, so it's there by the time the trip is built. The planner calls this when someone picks
 * Nightlife and has typed where they're going. { destination }
 */
export const POST = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  if (!ctx.user) throw new HttpError(401, "Sign in first.");
  const body = (await req.json().catch(() => ({}))) as { destination?: unknown };
  const city = cityOf(body.destination);
  if (city.length < 2) throw new HttpError(400, "Which city?");
  if (regionPolicy(city) !== "ok") return json({ status: "skipped" });
  if (await readPulse(city)) return json({ status: "ready" });
  await rateLimit(ctx, "extract", 20, "That's a lot of new cities this hour. Try again a little later.");
  waitUntil(nightPulse(city, Date.now() + 110_000));
  return json({ status: "started" }, 202);
});
