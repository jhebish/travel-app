import { requireUser } from "@/lib/auth";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forget one place. */
export const DELETE = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new HttpError(404, "Not found.");
  const { error, count } = await ctx.db.from("taste_signals").delete({ count: "exact" }).eq("id", params.id).eq("user_id", ctx.user.id);
  if (error) throw error;
  if (!count) throw new HttpError(404, "Not found.");
  return json({ ok: true });
});
