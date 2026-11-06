import { getCtx } from "@/lib/auth";
import { topCities, topTrips } from "@/lib/community";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Highest-ranked public trips, optionally for one city (?city=Lisbon), plus the cities with the most trips. */
export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  const city = (new URL(req.url).searchParams.get("city") ?? "").slice(0, 80);
  const [trips, cities] = await Promise.all([topTrips(ctx, city), topCities()]);
  return json({ trips, cities });
});
