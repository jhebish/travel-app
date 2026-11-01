import { StaySchema } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { clientIp } from "@/lib/ip";
import { generateHotels } from "@/lib/pipeline";
import type { TripRow } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Find (or replace) hotel options for an existing trip. */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const { stay } = await parseBody(req, z.object({ stay: StaySchema }));
  const { data } = await ctx.db.from("trips").select("*").eq("id", params.id).maybeSingle();
  if (!data) throw new HttpError(404, "Trip not found.");
  const trip = await generateHotels(ctx, data as TripRow, stay, { ip: clientIp(req) });
  return json({ trip });
});
