import { regionPolicy } from "@travel/core";
import { getCtx } from "@/lib/auth";
import { HttpError, handler, json } from "@/lib/http";
import { rateLimit } from "@/lib/tripAccess";
import { idealDays, readIdealDays } from "@/lib/tripLength";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * How long most people stay in a place, for trips built before new trips started carrying it.
 * ?destination=Lisbon&mode=single. Cached per destination; asks the model only on a miss.
 */
export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  if (!ctx.user) throw new HttpError(401, "Sign in to see this.");
  const q = new URL(req.url).searchParams;
  const destination = (q.get("destination") ?? "").trim().slice(0, 120);
  const mode = q.get("mode") === "multi" ? "multi" : "single";
  if (destination.length < 2) throw new HttpError(400, "Which place?");
  if (regionPolicy(destination) === "blocked") return json({ idealDays: null });
  const cached = await readIdealDays(destination, mode).catch(() => null);
  if (cached) return json({ idealDays: cached });
  await rateLimit(ctx, "extract", 30, "That's a lot of new places this hour. Try again a little later.");
  return json({ idealDays: await idealDays(destination, mode, Date.now() + 25_000) });
});
