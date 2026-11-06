import { getCtx } from "@/lib/auth";
import { feed } from "@/lib/community";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent trips from people I follow. */
export const GET = handler(async (req: Request) => json({ trips: await feed(await getCtx(req)) }));
