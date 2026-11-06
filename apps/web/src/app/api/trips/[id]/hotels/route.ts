import { StaySchema } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler, json, parseBody } from "@/lib/http";
import { clientIp } from "@/lib/ip";
import { generateHotels } from "@/lib/pipeline";
import { rateLimit, tripFor, tripForRole } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Find (or replace) hotel options for an existing trip. */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const { stay } = await parseBody(req, z.object({ stay: StaySchema }));
  const { row, role } = await tripFor(ctx, params.id);
  await rateLimit(ctx, "hotels", 20, "That's a lot of hotel searches this hour. Try again a little later.");
  const saved = await generateHotels(ctx, row, stay, { ip: clientIp(req) });
  return json({ trip: tripForRole(saved, role) });
});
