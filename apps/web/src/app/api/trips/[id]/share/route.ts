import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { toTrip, type TripRow } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Turn a trip's public link on or off. The token stays the same, so re-enabling restores the old link. */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const { enabled } = await parseBody(req, z.object({ enabled: z.boolean() }));
  const { data: row } = await ctx.db.from("trips").select("id, share_token").eq("id", params.id).maybeSingle();
  if (!row) throw new HttpError(404, "Trip not found.");
  const share_token = row.share_token ?? randomBytes(12).toString("base64url");
  const { data, error } = await ctx.db
    .from("trips")
    .update({ shared: enabled, share_token })
    .eq("id", params.id)
    .select("*")
    .single();
  if (error || !data) throw new HttpError(500, "Couldn't update sharing. Try again.");
  return json({ trip: toTrip(data as TripRow) });
});
