import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { getRecap, recapYear } from "@/lib/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** My year in travel (?year=2026, default this year). Only ever the caller's own data. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  return json(await getRecap(ctx, recapYear(new URL(req.url).searchParams.get("year"))));
});
