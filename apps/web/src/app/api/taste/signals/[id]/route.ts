import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, isUuid, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forget one place. */
export const DELETE = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  if (!isUuid(params.id)) throw new HttpError(404, "Not found.");
  const { error, count } = await ctx.db.from("taste_signals").delete({ count: "exact" }).eq("id", params.id).eq("user_id", ctx.user.id);
  if (error) throw error;
  if (!count) throw new HttpError(404, "Not found.");
  return json({ ok: true });
});

/** Say how you felt about a place you've been (a hotel on Places you've stayed, say): loved it, not for you, or neither. */
export const PATCH = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  if (!isUuid(params.id)) throw new HttpError(404, "Not found.");
  const { liked } = await parseBody(req, z.object({ liked: z.boolean().nullable() }));
  const { data, error } = await ctx.db.from("taste_signals").update({ liked }).eq("id", params.id).eq("user_id", ctx.user.id).select("id");
  if (error) throw error;
  if (!data?.length) throw new HttpError(404, "Not found.");
  return json({ ok: true, liked });
});
