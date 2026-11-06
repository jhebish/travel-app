import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler, json, parseBody } from "@/lib/http";
import { loadTogether, react } from "@/lib/together";
import { tripFor } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "I'm in" / "pass" on a stop or hotel, for whoever is asking (owner or friend). */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const { item, value } = await parseBody(
    req,
    z.object({ item: z.string().regex(/^([0-9]{1,2}-[0-9]{1,2}|h-[0-9]{1,2})$/), value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }),
  );
  const { row } = await tripFor(ctx, params.id);
  await react(ctx, row, item, value);
  return json({ together: await loadTogether(row, ctx.user.id) });
});
