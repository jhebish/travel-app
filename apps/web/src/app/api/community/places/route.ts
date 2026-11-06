import { PastTripInputSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { addPlace, myPlaces } from "@/lib/community";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => json({ places: await myPlaces(await requireUser(req)) }));

export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const p = await parseBody(req, PastTripInputSchema);
  return json({ place: await addPlace(ctx, p) }, 201);
});
