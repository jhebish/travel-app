import { getCtx } from "@/lib/auth";
import { forYou } from "@/lib/browse";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Destinations picked from the places this traveler has logged. */
export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  const guest = !ctx.user || !!(ctx.user as { is_anonymous?: boolean }).is_anonymous;
  return json({ ...(await forYou(ctx)), member: !guest, signedIn: !!ctx.user });
});
