import { getCtx } from "@/lib/auth";
import { friendsWhoveBeen } from "@/lib/friends";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Friends who've been to a city (?city=Lisbon), with what they loved there. */
export const GET = handler(async (req: Request) => {
  const city = (new URL(req.url).searchParams.get("city") ?? "").trim().slice(0, 120);
  return json({ friends: city ? await friendsWhoveBeen(await getCtx(req), city) : [] });
});
