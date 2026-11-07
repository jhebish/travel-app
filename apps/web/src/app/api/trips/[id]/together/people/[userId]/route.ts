import { requireUser } from "@/lib/auth";
import { HttpError, handler, isUuid, json } from "@/lib/http";
import { removePerson } from "@/lib/together";
import { tripFor } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The owner removes someone, or you leave a trip you were planning with friends. */
export const DELETE = handler(async (req: Request, { params }: { params: { id: string; userId: string } }) => {
  const ctx = await requireUser(req);
  if (!isUuid(params.userId)) throw new HttpError(404, "Not found.");
  const { row } = await tripFor(ctx, params.id);
  await removePerson(ctx, row, params.userId);
  return json({ ok: true });
});
