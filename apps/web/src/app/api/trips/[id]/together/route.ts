import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { addFriend, createInvite, loadTogether, mutualFriends } from "@/lib/together";
import { tripFor } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

/** Who's planning this trip, what they think of each stop, and friends you could add. */
export const GET = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const { row, role } = await tripFor(ctx, params.id);
  const [together, friends] = await Promise.all([loadTogether(row, ctx.user.id), role === "owner" ? mutualFriends(ctx) : Promise.resolve([])]);
  return json({ together, friends });
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("add"), handle: z.string().trim().min(3).max(24) }),
]);

/**
 * Make an invite link or add a friend directly: the owner only. A link a friend made would still
 * let them back in after the owner removed them (see removePerson).
 */
export const POST = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, Body);
  if (body.action === "invite") {
    const { row, role } = await tripFor(ctx, params.id);
    if (role !== "owner") throw new HttpError(403, "Only the trip's organizer can make invite links. Ask them for one.", "forbidden");
    const token = await createInvite(ctx, row);
    return json({ url: `${new URL(req.url).origin}/join/${token}` }, 201);
  }
  const { row } = await tripFor(ctx, params.id, "owner");
  await addFriend(ctx, row, body.handle);
  return json({ together: await loadTogether(row, ctx.user.id) });
});
