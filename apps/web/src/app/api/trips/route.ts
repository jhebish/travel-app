import { TripRequestSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { handler, json, parseBody } from "@/lib/http";
import { clientIp } from "@/lib/ip";
import { generateTrip } from "@/lib/pipeline";
import { ndjsonResponse } from "@/lib/stream";
import { sharedWithMe } from "@/lib/together";
import { toSummary, type SlimTripRow } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // generation can take up to ~90s

/** List my trips (newest first). ?filter=saved|rated */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const filter = new URL(req.url).searchParams.get("filter");
  // Only what the list shows: not every itinerary and intake answer.
  let q = ctx.db
    .from("trips")
    .select("id, created_at, destination, title, custom_mix, saved, rating, days:request->days, first_hotel:itinerary->hotels->0->>name")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter === "saved") q = q.eq("saved", true);
  if (filter === "rated") q = q.gt("rating", 0);
  const [{ data, error }, shared] = await Promise.all([q, filter ? Promise.resolve([]) : sharedWithMe(ctx)]);
  if (error) throw error;
  return json({ trips: (data as SlimTripRow[]).map(toSummary), shared });
});

/**
 * Build a new trip.
 * Clients that send `Accept: application/x-ndjson` get live progress: one JSON event per line
 * (progress, outline, day, hotels) and finally `{type:"done", trip}` or `{type:"error"}`.
 * Other clients (the mobile app) get a single JSON response as before.
 */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, TripRequestSchema);
  const opts = { ip: clientIp(req), tripsPerHour: env.tripsPerHour() };

  if (!(req.headers.get("accept") ?? "").includes("application/x-ndjson")) {
    const trip = await generateTrip(ctx, body, opts);
    return json({ trip }, 201);
  }

  return ndjsonResponse((send) => generateTrip(ctx, body, opts, send));
});
