import { VisibilitySchema } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { setVisibility } from "@/lib/community";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { setShareWhileAway } from "@/lib/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who can see this trip in the community: private | followers | public. `shareWhileAway` shows a
 * dated trip before it's over (off by default: others see it from the day after it ends).
 */
export const PUT = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const { visibility, shareWhileAway } = await parseBody(req, z.object({ visibility: VisibilitySchema.optional(), shareWhileAway: z.boolean().optional() }));
  if (!visibility && shareWhileAway === undefined) throw new HttpError(400, "Some fields are invalid.", "invalid_request");
  if (visibility) await setVisibility(ctx, params.id, visibility);
  if (shareWhileAway !== undefined) await setShareWhileAway(ctx, params.id, shareWhileAway);
  return json({ visibility, shareWhileAway });
});
