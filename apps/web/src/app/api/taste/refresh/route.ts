import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { refreshTaste } from "@/lib/taste";
import { rateLimit } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Rebuild the taste profile if anything changed since it was last built. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  await rateLimit(ctx, "taste", 40, "Your taste is updating a lot this hour. Try again a little later.");
  return json({ profile: await refreshTaste(ctx) });
});
