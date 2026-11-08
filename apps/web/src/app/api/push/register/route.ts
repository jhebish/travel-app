import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().trim().regex(/^Expo(nent)?PushToken\[.{5,180}\]$/),
  platform: z.enum(["ios", "android"]),
});

/** The phone app registers its push token after the person allows notifications. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  if (ctx.user.is_anonymous) throw new HttpError(403, "Sign in to get notifications.", "guest");
  const { token, platform } = await parseBody(req, Body);
  const { error } = await ctx.db
    .from("push_tokens")
    .upsert({ token, platform, user_id: ctx.user.id, updated_at: new Date().toISOString() }, { onConflict: "token" });
  if (error) {
    // A token registered to someone else on this phone before (they signed out, you signed in):
    // RLS won't let us take over their row, so it stays with them until Expo drops it.
    if (error.code === "42501") return json({ ok: false });
    throw error;
  }
  return json({ ok: true });
});

/** Signing out on the phone: stop notifying it. */
export const DELETE = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { token } = await parseBody(req, Body.pick({ token: true }));
  await ctx.db.from("push_tokens").delete().eq("token", token).eq("user_id", ctx.user.id);
  return json({ ok: true });
});
