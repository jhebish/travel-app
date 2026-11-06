import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { mutualFriends } from "@/lib/together";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Friends you can plan with: people you follow who follow you back. */
export const GET = handler(async (req: Request) => json({ friends: await mutualFriends(await requireUser(req)) }));
