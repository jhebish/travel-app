import { CommunityProfileInputSchema } from "@travel/core";
import { getCtx, requireUser } from "@/lib/auth";
import { getMyProfile, myPlaces, saveMyProfile } from "@/lib/community";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** My community profile (null if I haven't joined) and my places. */
export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  const guest = !ctx.user || !!(ctx.user as { is_anonymous?: boolean }).is_anonymous;
  const [profile, places] = await Promise.all([getMyProfile(ctx), myPlaces(ctx)]);
  return json({ profile, places, canJoin: !guest });
});

/** Create or update my community profile. */
export const PUT = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const input = await parseBody(req, CommunityProfileInputSchema);
  return json({ profile: await saveMyProfile(ctx, input) });
});
