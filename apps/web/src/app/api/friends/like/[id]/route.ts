import { getCtx } from "@/lib/auth";
import { likeTrip } from "@/lib/friends";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Plan a trip like this": the past trip to start from, if this viewer may see it. */
export const GET = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const like = await likeTrip(await getCtx(req), params.id);
  if (!like) throw new HttpError(404, "We couldn't find that trip.");
  return json({ like });
});
