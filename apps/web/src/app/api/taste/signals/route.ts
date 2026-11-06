import { TasteSignalSchema, type TasteSignal } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { signalRow } from "@/lib/taste";

export const runtime = "nodejs";
const dedupe = (list: TasteSignal[]) => [...new Map(list.map((s) => [`${s.source}|${s.ref}`, s])).values()];
export const dynamic = "force-dynamic";

const Body = z.object({
  signals: z.array(z.unknown()).min(1).max(2000),
  /** Attach them to one of your past trips ("what you did there"). */
  pastTripId: z.string().uuid().nullable().optional(),
});

/** Add places you've been (typed in, or confirmed from an import). Re-adding the same place is a no-op. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, Body);
  const signals = dedupe(body.signals.map((s) => TasteSignalSchema.safeParse(s)).flatMap((r) => (r.success ? [r.data] : [])));
  if (!signals.length) throw new HttpError(400, "None of those places could be read.", "invalid_request");
  if (body.pastTripId) {
    const { data } = await ctx.db.from("past_trips").select("id").eq("id", body.pastTripId).eq("user_id", ctx.user.id).maybeSingle();
    if (!data) throw new HttpError(404, "That trip isn't in your places.");
  }
  const rows = signals.map((s) => signalRow(ctx.user.id, s, body.pastTripId ?? null));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await ctx.db
      .from("taste_signals")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,source,ref", ignoreDuplicates: true })
      .select("id");
    if (error) {
      if (error.code === "42P01") throw new HttpError(503, "Taste isn't switched on yet. Try again soon.", "taste_off");
      throw error;
    }
    added += data?.length ?? 0;
  }
  return json({ added, skipped: signals.length - added }, 201);
});
