import { HttpError, handler, json } from "@/lib/http";
import { getSharedTrip } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public read of a shared trip (used by the mobile app; the web page reads it server-side). */
export const GET = handler(async (_req: Request, { params }: { params: { token: string } }) => {
  const trip = await getSharedTrip(params.token);
  if (!trip) throw new HttpError(404, "This trip isn't shared anymore.");
  return json({ trip });
});
