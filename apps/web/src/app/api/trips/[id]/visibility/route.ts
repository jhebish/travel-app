import { VisibilitySchema } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { setVisibility } from "@/lib/community";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who can see this trip in the community: private | followers | public. */
export const PUT = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const { visibility } = await parseBody(req, z.object({ visibility: VisibilitySchema }));
  await setVisibility(ctx, params.id, visibility);
  return json({ visibility });
});
