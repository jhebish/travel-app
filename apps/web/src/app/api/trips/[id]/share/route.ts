import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler, json, parseBody } from "@/lib/http";
import { tripFor, updateTrip } from "@/lib/tripAccess";
import { toTrip } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Turn a trip's public link on or off (owner only). The token stays the same, so re-enabling restores the old link. */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const { enabled } = await parseBody(req, z.object({ enabled: z.boolean() }));
  const { row } = await tripFor(ctx, params.id, "owner");
  const saved = await updateTrip(row, { shared: enabled, share_token: row.share_token ?? randomBytes(12).toString("base64url") });
  return json({ trip: toTrip(saved) });
});
