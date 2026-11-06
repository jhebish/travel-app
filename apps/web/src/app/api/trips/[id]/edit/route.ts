import { EditSchema } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { handler, json, parseBody } from "@/lib/http";
import { regenerateDay, setLocked, swapCity, swapStop } from "@/lib/pipeline";
import { editPeople } from "@/lib/together";
import { tripFor, tripForRole } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Swap one stop, rebuild one day (keeping locked stops and ones a friend is in for), lock a stop,
 * or swap a whole stop on a multi-city route for another town.
 * The owner and friends planning the trip can all edit; everyone's taste is blended in.
 */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireUser(req);
  const edit = await parseBody(req, EditSchema);
  const { row, role } = await tripFor(ctx, params.id);
  const people = edit.action === "lock" ? undefined : await editPeople(row);
  const saved =
    edit.action === "swap"
      ? await swapStop(ctx, row, edit.day, edit.index, edit.hint, people)
      : edit.action === "regenerate_day"
        ? await regenerateDay(ctx, row, edit.day, edit.hint, people)
        : edit.action === "swap_city"
          ? await swapCity(ctx, row, edit.leg, edit.city, people)
          : await setLocked(ctx, row, edit.day, edit.index, edit.locked);
  return json({ trip: tripForRole(saved, role) });
});
