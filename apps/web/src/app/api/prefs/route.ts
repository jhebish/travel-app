import { PrefsSchema, defaultWeights, isSourceId } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** My personal source mix. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { data } = await ctx.db.from("user_prefs").select("*").eq("user_id", ctx.user.id).maybeSingle();
  return json({
    prefs: data
      ? { useCustom: !!data.use_custom, weights: { ...defaultWeights(), ...data.weights }, blocked: (data.blocked ?? []).filter(isSourceId) }
      : null,
  });
});

export const PUT = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const p = await parseBody(req, PrefsSchema);
  const { error } = await ctx.db.from("user_prefs").upsert({
    user_id: ctx.user.id,
    use_custom: p.useCustom,
    weights: p.weights,
    blocked: p.blocked,
  });
  if (error) throw error;
  return json({ prefs: p });
});
