import { TripRequestSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { handler, json, parseBody } from "@/lib/http";
import { clientIp } from "@/lib/ip";
import { generateTrip } from "@/lib/pipeline";
import { toSummary, type TripRow } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // generation can take up to ~90s

/** List my trips (newest first). ?filter=saved|rated */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const filter = new URL(req.url).searchParams.get("filter");
  let q = ctx.db
    .from("trips")
    .select("id, user_id, created_at, updated_at, destination, title, request, custom_mix, itinerary, saved, rating")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter === "saved") q = q.eq("saved", true);
  if (filter === "rated") q = q.gt("rating", 0);
  const { data, error } = await q;
  if (error) throw error;
  return json({ trips: (data as TripRow[]).map(toSummary) });
});

/** Build a new trip. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, TripRequestSchema);
  const trip = await generateTrip(ctx, body, { ip: clientIp(req), tripsPerHour: env.tripsPerHour() });
  return json({ trip }, 201);
});
