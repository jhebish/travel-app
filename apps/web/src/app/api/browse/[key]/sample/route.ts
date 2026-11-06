import { DESTINATION_BY_KEY } from "@travel/core";
import { ensureSample, longDays } from "@/lib/browse";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Plan the destination's itinerary if it doesn't exist yet (once, for everyone); ?long=1 plans
 * the longer version the days slider trims from. Returns it, or a status to poll on.
 */
export const POST = handler(async (req: Request, { params }: { params: { key: string } }) => {
  const d = DESTINATION_BY_KEY[params.key];
  if (!d) throw new HttpError(404, "We don't have that destination.");
  const long = !!new URL(req.url).searchParams.get("long");
  return json({ sample: await ensureSample(params.key, long ? longDays(d) : undefined) });
});
