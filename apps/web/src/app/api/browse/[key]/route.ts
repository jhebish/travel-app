import { DESTINATION_BY_KEY } from "@travel/core";
import { getCtx } from "@/lib/auth";
import { readSample } from "@/lib/browse";
import { topTrips } from "@/lib/community";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One destination: its sample itinerary (if planned yet) and the best public trips there. */
export const GET = handler(async (req: Request, { params }: { params: { key: string } }) => {
  const d = DESTINATION_BY_KEY[params.key];
  if (!d) throw new HttpError(404, "We don't have that destination.");
  const ctx = await getCtx(req);
  const [sample, trips] = await Promise.all([readSample(d.key), topTrips(ctx, d.name).catch(() => [])]);
  return json({ destination: d, sample, trips: trips.slice(0, 6) });
});
