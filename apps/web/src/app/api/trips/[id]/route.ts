import { FeedbackPatchSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { syncFeedback } from "@/lib/feedback";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { toTrip, type TripRow } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

const UUID = /^[0-9a-f-]{36}$/i;

export const GET = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  if (!UUID.test(params.id)) throw new HttpError(404, "Trip not found.");
  const { data } = await ctx.db.from("trips").select("*").eq("id", params.id).maybeSingle();
  if (!data) throw new HttpError(404, "Trip not found.");
  return json({ trip: toTrip(data as TripRow) });
});

/** Save, rate, or vote on stops and hotels. */
export const PATCH = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  if (!UUID.test(params.id)) throw new HttpError(404, "Trip not found.");
  const patch = await parseBody(req, FeedbackPatchSchema);
  const { data, error } = await ctx.db.from("trips").update(patch).eq("id", params.id).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Trip not found.");
  await syncFeedback(data as TripRow);
  return json({ trip: toTrip(data as TripRow) });
});

/** Remove a trip; its anonymized feedback is removed with it. */
export const DELETE = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  if (!UUID.test(params.id)) throw new HttpError(404, "Trip not found.");
  const { error, count } = await ctx.db.from("trips").delete({ count: "exact" }).eq("id", params.id);
  if (error) throw error;
  if (!count) throw new HttpError(404, "Trip not found.");
  return json({ ok: true });
});
