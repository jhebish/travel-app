import { requireUser } from "@/lib/auth";
import { tripAnswers } from "@/lib/asks";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "From friends" on a trip (its owner only): their answers, and questions still waiting. */
export const GET = handler(async (req: Request, { params }: { params: { id: string } }) => json({ asks: await tripAnswers(await requireUser(req), params.id) }));
