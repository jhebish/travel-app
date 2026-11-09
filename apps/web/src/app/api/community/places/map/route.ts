import { cityKey, type PastTrip, type PlacePoint } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { myPlaces } from "@/lib/community";
import { cityCentre } from "@/lib/geo";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** At most this many cities looked up on Google per visit; the rest are placed on the next. */
const NEW_LOOKUPS = 30;

/**
 * Places you've been, as pins for a map: one per city, with how many trips and which years.
 * `pending` counts the cities not placed yet (looked up on a later visit). A name that can't be
 * placed at all (a typo, say) is left off the map; it's still in the list of trips.
 */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const places = await myPlaces(ctx);
  const groups = new Map<string, { city: string; countryCode: string; trips: PastTrip[] }>();
  for (const p of places) {
    const key = `${p.countryCode.toUpperCase()}:${cityKey(p.city)}`;
    const g = groups.get(key) ?? { city: p.city, countryCode: p.countryCode.toUpperCase(), trips: [] };
    g.trips.push(p);
    groups.set(key, g);
  }
  let lookups = 0;
  const mayLookUp = () => lookups++ < NEW_LOOKUPS;
  const queue = [...groups];
  const points: PlacePoint[] = [];
  let pending = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const [key, g] = queue.shift()!;
        const at = await cityCentre(g.city, g.countryCode, mayLookUp);
        if (at === "later") pending++;
        if (typeof at !== "object") continue;
        const years = [...new Set(g.trips.map((t) => t.year).filter((y): y is number => y != null))].sort((a, b) => b - a);
        points.push({ key, city: g.city, countryCode: g.countryCode, lat: at.lat, lng: at.lng, trips: g.trips.length, years });
      }
    }),
  );
  return json({ points: points.sort((a, b) => b.trips - a.trips || a.city.localeCompare(b.city)), pending });
});
