import { requireUser } from "@/lib/auth";
import { HttpError, handler, json } from "@/lib/http";
import { acceptInvite, inviteInfo } from "@/lib/together";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { token: string } };

/** What an invite is for (title, destination, who's inviting). */
export const GET = handler(async (_req: Request, { params }: P) => {
  const info = await inviteInfo(params.token);
  if (!info) throw new HttpError(404, "That invite link doesn't work. Ask for a new one.");
  const { tripId: _id, ...rest } = info;
  return json({ invite: rest });
});

/** Join the trip's planning. */
export const POST = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  return json({ tripId: await acceptInvite(ctx, params.token) });
});
