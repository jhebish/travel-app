import { getCtx } from "@/lib/auth";
import { getProfile } from "@/lib/community";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, { params }: { params: { handle: string } }) => {
  const ctx = await getCtx(req);
  const out = await getProfile(ctx, params.handle);
  if (!out) throw new HttpError(404, "We couldn't find that person.");
  return json(out);
});
