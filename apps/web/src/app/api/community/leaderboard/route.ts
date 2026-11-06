import { getCtx } from "@/lib/auth";
import { leaderboard } from "@/lib/community";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Me and the people I follow, most-travelled first. */
export const GET = handler(async (req: Request) => json({ rows: await leaderboard(await getCtx(req)) }));
