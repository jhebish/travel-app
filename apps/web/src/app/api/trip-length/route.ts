import { regionPolicy } from "@travel/core";
import { getCtx } from "@/lib/auth";
import { HttpError, handler, json } from "@/lib/http";
import { rateLimit } from "@/lib/tripAccess";
import { idealDays, readIdealDays } from "@/lib/tripLength";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * How long most people stay in a place, for trips that don't carry it yet (older trips, shared
 * links, destination pages). ?destination=Lisbon&mode=single. Anyone gets a cached answer; only a
 * signed-in traveler's visit asks the model when there isn't one.
 */
export const GET = handler(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const destination = (q.get("destination") ?? "").trim().slice(0, 120);
  const mode = q.get("mode") === "multi" ? "multi" : "single";
  if (destination.length < 2) throw new HttpError(400, "Which place?");
  if (regionPolicy(destination) === "blocked") return json({ idealDays: null });
  const cached = await readIdealDays(destination, mode).catch(() => null);
  if (cached) return json({ idealDays: cached });
  const ctx = await getCtx(req);
  if (!ctx.user) return json({ idealDays: null });
  await rateLimit(ctx, "extract", 30, "That's a lot of new places this hour. Try again a little later.");
  return json({ idealDays: await idealDays(destination, mode, Date.now() + 25_000) });
});
