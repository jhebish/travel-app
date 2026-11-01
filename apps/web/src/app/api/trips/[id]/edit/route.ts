import { EditSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { regenerateDay, setLocked, swapStop } from "@/lib/pipeline";
import type { TripRow } from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Swap one stop, rebuild one day (keeping locked stops), or lock/unlock a stop. */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const edit = await parseBody(req, EditSchema);
  const { data } = await ctx.db.from("trips").select("*").eq("id", params.id).maybeSingle();
  if (!data) throw new HttpError(404, "Trip not found.");
  const row = data as TripRow;
  const trip =
    edit.action === "swap"
      ? await swapStop(ctx, row, edit.day, edit.index, edit.hint)
      : edit.action === "regenerate_day"
        ? await regenerateDay(ctx, row, edit.day, edit.hint)
        : await setLocked(ctx, row, edit.day, edit.index, edit.locked);
  return json({ trip });
});
