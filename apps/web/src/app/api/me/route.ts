import { z } from "zod";
import { getCtx, requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  return json({
    user: ctx.user ? { id: ctx.user.id, email: ctx.user.email || undefined, isGuest: !!ctx.user.is_anonymous } : null,
    role: ctx.role,
  });
});

/**
 * Delete the caller's account for good: trips, saved and imported places, taste profile, follows,
 * community profile and everything else, which all cascade from the auth user. The App Store
 * requires apps with accounts to offer this in the app. The body must say so explicitly.
 */
export const DELETE = handler(async (req: Request) => {
  const { user } = await requireUser(req);
  await parseBody(req, z.object({ confirm: z.literal("delete") }));
  const { error } = await supabaseAdmin().auth.admin.deleteUser(user.id);
  if (error) {
    console.error("Account deletion failed", user.id, error.message);
    throw new HttpError(500, "We couldn't delete your account. Try again, or email team@newcenturydevelopment.com and we'll do it for you.", "delete_failed");
  }
  return json({ deleted: true });
});
