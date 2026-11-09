import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { pastStays } from "@/lib/taste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Places you've stayed: every hotel and rental your calendar, email and photos turned up, and the
 * ones you added, as one list (the same place found twice is one entry). Like, dislike or remove
 * an entry through /api/taste/signals/[id] for each of its `ids`. Hotel picks read this list.
 */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  return json({ stays: await pastStays(ctx.db, ctx.user.id) });
});
