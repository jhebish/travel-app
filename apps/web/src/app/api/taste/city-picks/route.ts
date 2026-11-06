import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { cityPicks } from "@/lib/cityPicks";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The well-known places in a city, for logging a past trip by ticking what you loved. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { city } = await parseBody(req, z.object({ city: z.string().trim().min(2).max(80) }));
  const picks = await cityPicks(ctx, city);
  return json(picks);
});
