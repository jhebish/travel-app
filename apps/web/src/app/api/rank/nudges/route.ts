import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { rankNudges } from "@/lib/rank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trips just over that you haven't ranked ("Back from Lisbon?"), and your dated Pylos trips still
 * to end (the phone app schedules a reminder for the morning after each). Only your own trips and
 * ones friends are planning with you.
 */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  return json(await rankNudges(ctx));
});
