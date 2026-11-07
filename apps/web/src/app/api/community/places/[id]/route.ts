import { PastTripInputSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { deletePlace, updatePlace } from "@/lib/community";
import { HttpError, handler, isUuid, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkId = (id: string) => {
  if (!isUuid(id)) throw new HttpError(404, "That place isn't in your list.");
};

export const PUT = handler(async (req: Request, { params }: { params: { id: string } }) => {
  checkId(params.id);
  const ctx = await requireUser(req);
  const p = await parseBody(req, PastTripInputSchema);
  return json({ place: await updatePlace(ctx, params.id, p) });
});

export const DELETE = handler(async (req: Request, { params }: { params: { id: string } }) => {
  checkId(params.id);
  await deletePlace(await requireUser(req), params.id);
  return json({ ok: true });
});
