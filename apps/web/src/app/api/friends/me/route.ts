import { z } from "zod";
import { getCtx, requireUser } from "@/lib/auth";
import { friendsMe, setPicksForFriends } from "@/lib/friends";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your friends settings: whether friends' planners may use your places, your local cities, and your credits. */
export const GET = handler(async (req: Request) => json(await friendsMe(await getCtx(req))));

/** "Let friends' planners use places I loved". */
export const PUT = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { picksForFriends } = await parseBody(req, z.object({ picksForFriends: z.boolean() }));
  return json({ picksForFriends: await setPicksForFriends(ctx, picksForFriends) });
});
