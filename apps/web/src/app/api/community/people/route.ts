import { getCtx } from "@/lib/auth";
import { searchPeople } from "@/lib/community";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?q= search by handle or name. With no query: people who follow you that you don't follow back. */
export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return json({ people: await searchPeople(ctx, q) });
});
