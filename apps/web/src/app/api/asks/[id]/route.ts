import { AskReplySchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { askToAnswer, replyAsk } from "@/lib/asks";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

/** A question for me, with the places I've logged in its city to answer from. */
export const GET = handler(async (req: Request, { params }: P) => json(await askToAnswer(await requireUser(req), params.id)));

/** Answer it (a few words and up to 12 places) or decline it. */
export const POST = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const reply = await parseBody(req, AskReplySchema);
  return json({ ask: await replyAsk(ctx, params.id, reply) });
});
