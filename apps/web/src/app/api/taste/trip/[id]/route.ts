import { SIGNAL_KINDS, TasteSignalSchema } from "@travel/core";
import { z } from "zod";
import { requireUser, type Ctx } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { signalRow } from "@/lib/taste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

/** What you did on one past trip: the places you typed in for it. */
async function ownTrip(ctx: Ctx & { user: { id: string } }, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Trip not found.");
  const { data } = await ctx.db.from("past_trips").select("id, city, country_code, year, month").eq("id", id).eq("user_id", ctx.user.id).maybeSingle();
  if (!data) throw new HttpError(404, "Trip not found.");
  return data as { id: string; city: string; country_code: string; year: number | null; month: number | null };
}

export const GET = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  await ownTrip(ctx, params.id);
  const { data } = await ctx.db
    .from("taste_signals")
    .select("id, kind, name, rating, liked, note")
    .eq("past_trip_id", params.id)
    .eq("source", "manual")
    .order("created_at");
  return json({ items: data ?? [] });
});

const Item = z.object({
  kind: z.enum(SIGNAL_KINDS),
  name: z.string().trim().min(1).max(120),
  liked: z.boolean().nullable().default(null),
  note: z.string().trim().max(280).default(""),
});

/** Replace the list of places for this trip. */
export const PUT = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const trip = await ownTrip(ctx, params.id);
  const { items } = await parseBody(req, z.object({ items: z.array(Item).max(40) }));
  const date = trip.year ? `${trip.year}-${String(trip.month ?? 1).padStart(2, "0")}-01` : null;
  const rows = items.map((it, i) =>
    signalRow(
      ctx.user.id,
      TasteSignalSchema.parse({
        source: "manual",
        ref: `trip:${trip.id}:${i}:${it.kind}:${it.name.toLowerCase().slice(0, 60)}`,
        kind: it.kind,
        name: it.name,
        city: trip.city,
        countryCode: trip.country_code,
        date,
        liked: it.liked,
        note: it.note || null,
      }),
      trip.id,
    ),
  );
  const { error: delErr } = await ctx.db.from("taste_signals").delete().eq("past_trip_id", trip.id).eq("source", "manual").eq("user_id", ctx.user.id);
  if (delErr) {
    if (delErr.code === "42P01") throw new HttpError(503, "Taste isn't switched on yet. Try again soon.", "taste_off");
    throw delErr;
  }
  if (rows.length) {
    const { error } = await ctx.db.from("taste_signals").insert(rows);
    if (error) throw error;
  }
  return json({ ok: true, items: rows.length });
});
