import { requireUser } from "@/lib/auth";
import { HttpError, handler } from "@/lib/http";
import { recapStoryImage } from "@/lib/ogPages";
import { getRecap, recapYear } from "@/lib/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Your 2026 in travel" as a 1080×1920 story image (?year=). Signed in only, and only ever your own year. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const dto = await getRecap(ctx, recapYear(new URL(req.url).searchParams.get("year")));
  if (!dto.recap.trips) throw new HttpError(404, "There are no trips logged for that year yet.");
  return recapStoryImage(dto);
});
