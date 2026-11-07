import { LocalPickReviewSchema } from "@travel/core";
import { requireCurator } from "@/lib/auth";
import { HttpError, handler, isUuid, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

/** Approve / reject a pick, change its source, or attach an Expedia property id for live rates. */
export const PATCH = handler(async (req: Request, { params }: P) => {
  const ctx = await requireCurator(req);
  if (!isUuid(params.id)) throw new HttpError(404, "Pick not found.");
  const r = await parseBody(req, LocalPickReviewSchema);
  const update: Record<string, unknown> = { reviewed_by: ctx.user.id };
  if (r.status) update.status = r.status;
  if (r.source) update.source = r.source;
  if (r.note !== undefined) update.note = r.note;
  if (r.expediaPropertyId !== undefined) update.expedia_property_id = r.expediaPropertyId || null;
  const { data, error } = await ctx.db.from("local_picks").update(update).eq("id", params.id).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Pick not found.");
  return json({ pick: data });
});

export const DELETE = handler(async (req: Request, { params }: P) => {
  const ctx = await requireCurator(req);
  if (!isUuid(params.id)) throw new HttpError(404, "Pick not found.");
  const { error } = await ctx.db.from("local_picks").delete().eq("id", params.id);
  if (error) throw error;
  return json({ ok: true });
});
