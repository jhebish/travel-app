import { FeedbackPatchSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { syncFeedback } from "@/lib/feedback";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { loadTogether, memberIds } from "@/lib/together";
import { tripFor, tripForRole } from "@/lib/tripAccess";
import { toTrip, type TripRow } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

/** A trip you own or are planning with friends, plus who's planning it and what they think. */
export const GET = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const { row, role } = await tripFor(ctx, params.id);
  const together = role === "member" || (await memberIds(row.id)).length ? await loadTogether(row, ctx.user.id) : null;
  return json({ trip: tripForRole(row, role), together });
});

/** Save, rate, or vote on stops and hotels (your own trips). */
export const PATCH = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  await tripFor(ctx, params.id, "owner");
  const patch = await parseBody(req, FeedbackPatchSchema);
  const { data, error } = await ctx.db.from("trips").update(patch).eq("id", params.id).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Trip not found.");
  await syncFeedback(data as TripRow);
  return json({ trip: toTrip(data as TripRow) });
});

/** Remove a trip; its anonymized feedback is removed with it. Owners only. */
export const DELETE = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  await tripFor(ctx, params.id, "owner");
  const { error, count } = await ctx.db.from("trips").delete({ count: "exact" }).eq("id", params.id);
  if (error) throw error;
  if (!count) throw new HttpError(404, "Trip not found.");
  return json({ ok: true });
});
