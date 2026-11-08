import { PastTripInputSchema } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { addPlacesBulk } from "@/lib/community";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Add several past trips at once (from an import). Trips already logged are skipped, but a longer
 * stay than the one logged raises its days: `{ added, skipped, updated }`.
 */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { places } = await parseBody(req, z.object({ places: z.array(PastTripInputSchema).min(1).max(100) }));
  return json(await addPlacesBulk(ctx, places), 201);
});
