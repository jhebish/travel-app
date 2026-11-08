import { regionPolicy } from "@travel/core";
import { getCtx } from "@/lib/auth";
import { HttpError, handler, json } from "@/lib/http";
import { readStayScale, stayScale } from "@/lib/stayScale";
import { rateLimit } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * What hotels cost in a place, so the $ to $$$$ choices can show local prices.
 * ?destination=Cairo. Anyone gets a cached answer; only a signed-in visit asks the model when
 * there isn't one.
 */
export const GET = handler(async (req: Request) => {
  const destination = (new URL(req.url).searchParams.get("destination") ?? "").trim().slice(0, 120);
  if (destination.length < 2) throw new HttpError(400, "Which place?");
  if (regionPolicy(destination) === "blocked") return json({ scale: null });
  const cached = await readStayScale(destination).catch(() => null);
  if (cached) return json({ scale: cached });
  const ctx = await getCtx(req);
  if (!ctx.user) return json({ scale: null });
  await rateLimit(ctx, "extract", 30, "That's a lot of new places this hour. Try again a little later.");
  return json({ scale: await stayScale(destination, Date.now() + 25_000) });
});
