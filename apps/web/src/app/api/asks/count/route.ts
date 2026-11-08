import { getCtx } from "@/lib/auth";
import { openAskCount } from "@/lib/asks";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many questions are waiting for my answer (the count by Friends in the menu). */
export const GET = handler(async (req: Request) => json({ open: await openAskCount(await getCtx(req)) }));
