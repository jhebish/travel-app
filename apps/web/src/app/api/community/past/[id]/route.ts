import { VisibilitySchema } from "@travel/core";
import { z } from "zod";
import { getCtx, requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { getPastTripPage, setPastTripPrivacy } from "@/lib/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

/** A past trip's page (/p/[id]), if I'm allowed to see it: community-safe fields only. */
export const GET = handler(async (req: Request, { params }: P) => {
  const page = await getPastTripPage(await getCtx(req), params.id);
  if (!page) throw new HttpError(404, "This trip is private or no longer exists.");
  return json(page);
});

/** Who sees one of my past trips, and whether its dates show. */
export const PATCH = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, z.object({ visibility: VisibilitySchema.optional(), hideDates: z.boolean().optional() }));
  return json({ place: await setPastTripPrivacy(ctx, params.id, body) });
});
