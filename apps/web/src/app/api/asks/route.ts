import { AskCreateSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { createAsk, listAsks } from "@/lib/asks";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Questions friends asked me, and the ones I asked. */
export const GET = handler(async (req: Request) => json(await listAsks(await requireUser(req))));

/** Ask a friend (someone who follows you back) about a city. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const input = await parseBody(req, AskCreateSchema);
  return json({ ask: await createAsk(ctx, input) }, 201);
});
