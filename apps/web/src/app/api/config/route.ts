import { AppConfigSchema, defaultWeights, isSourceId } from "@travel/core";
import { getCtx, requireCurator } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** App-wide source defaults. Anyone can read; curators can change. */
export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  const { data } = await ctx.db.from("app_config").select("*").eq("id", 1).maybeSingle();
  if (!data) throw new HttpError(500, "App settings are missing. Run the database migration.");
  return json({
    config: {
      weights: { ...defaultWeights(), ...data.weights },
      blocked: (data.blocked ?? []).filter(isSourceId),
      alwaysFeature: data.always_feature ?? "",
      neverRecommend: data.never_recommend ?? "",
      updatedAt: data.updated_at,
    },
  });
});

export const PUT = handler(async (req: Request) => {
  const ctx = await requireCurator(req);
  const c = await parseBody(req, AppConfigSchema);
  const { error } = await ctx.db
    .from("app_config")
    .update({
      weights: c.weights,
      blocked: c.blocked,
      always_feature: c.alwaysFeature,
      never_recommend: c.neverRecommend,
      updated_by: ctx.user.id,
    })
    .eq("id", 1);
  if (error) throw error;
  return json({ config: c });
});
