import { LocalPickInputSchema } from "@travel/core";
import { isCurator, requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { verifyPlace } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Curators see every pick (?status=pending|approved|rejected, ?city=); locals see their own. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const url = new URL(req.url);
  let q = ctx.db.from("local_picks").select("*").order("created_at", { ascending: false }).limit(300);
  const status = url.searchParams.get("status");
  const city = url.searchParams.get("city");
  if (status && ["pending", "approved", "rejected"].includes(status)) q = q.eq("status", status);
  if (city) q = q.ilike("city", `%${city.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (!isCurator(ctx.role)) q = q.eq("submitted_by", ctx.user.id);
  const { data, error } = await q;
  if (error) throw error;
  return json({ picks: data ?? [] });
});

/** Locals, hosts and curators submit a spot. It waits for curator approval. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  if (!["local", "curator", "admin"].includes(ctx.role))
    throw new HttpError(403, "Ask a curator to give you local access to submit picks.", "forbidden");
  const p = await parseBody(req, LocalPickInputSchema);
  const place = await verifyPlace(p.name, p.neighborhood ?? "", p.city).catch(() => null);
  const { data, error } = await ctx.db
    .from("local_picks")
    .insert({
      city: p.city,
      name: p.name,
      neighborhood: p.neighborhood ?? null,
      category: p.category,
      source: p.source,
      note: p.note ?? null,
      tags: p.tags,
      price_band: p.category === "stay" ? (p.priceBand ?? null) : null,
      stay_style: p.category === "stay" ? (p.stayStyle ?? null) : null,
      google_place_id: place?.placeId ?? null,
      status: "pending",
      submitted_by: ctx.user.id,
    })
    .select("*")
    .single();
  if (error) throw error;
  return json({ pick: data, verified: !!place }, 201);
});
