import { getCtx } from "@/lib/auth";
import { getCommunityTrip } from "@/lib/community";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Someone's trip, if I'm allowed to see it (community-safe fields only). */
export const GET = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const trip = await getCommunityTrip(await getCtx(req), params.id);
  if (!trip) throw new HttpError(404, "This trip is private or no longer exists.");
  return json({ trip });
});
