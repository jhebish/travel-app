import { PICK_KINDS, PastTripInputSchema, TasteSignalSchema, cityKey } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { addPlace } from "@/lib/community";
import { handler, json, parseBody } from "@/lib/http";
import { signalRow } from "@/lib/taste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  trip: PastTripInputSchema,
  /** The places they ticked: all loved. */
  loved: z
    .array(
      z.object({
        kind: z.enum(PICK_KINDS),
        name: z.string().trim().min(1).max(120),
        note: z.string().trim().max(80).default(""),
      }),
    )
    .max(48)
    .default([]),
});

/** Log a past trip in one go: the city, and the places they loved there. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { trip, loved } = await parseBody(req, Body);
  const place = await addPlace(ctx, trip);
  const date = place.year ? `${place.year}-${String(place.month ?? 1).padStart(2, "0")}-01` : null;
  const seen = new Set<string>();
  const rows = loved
    .filter((it) => {
      const k = it.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((it, i) =>
      signalRow(
        ctx.user.id,
        TasteSignalSchema.parse({
          source: "manual",
          ref: `trip:${place.id}:${i}:${it.kind}:${cityKey(it.name).slice(0, 60)}`,
          kind: it.kind,
          name: it.name,
          city: place.city,
          countryCode: place.countryCode,
          date,
          liked: true,
          note: it.note || null,
        }),
        place.id,
      ),
    );
  let saved = 0;
  if (rows.length) {
    const { error } = await ctx.db.from("taste_signals").insert(rows);
    if (error) console.error("quick log signals failed", error.code, error.message);
    else saved = rows.length;
  }
  return json({ place, loved: saved, lost: rows.length - saved }, 201);
});
