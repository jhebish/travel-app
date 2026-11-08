import { HANDLE_RE } from "@travel/core";
import { getCtx } from "@/lib/auth";
import { localCitiesFor } from "@/lib/friends";
import { HttpError, handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The cities someone is a local expert for ("Local expert: Lisbon"). */
export const GET = handler(async (req: Request, { params }: { params: { handle: string } }) => {
  const handle = params.handle.toLowerCase();
  if (!HANDLE_RE.test(handle)) throw new HttpError(404, "We couldn't find that person.");
  const cities = await localCitiesFor(await getCtx(req), handle);
  if (!cities) throw new HttpError(404, "We couldn't find that person.");
  return json({ localCities: cities });
});
