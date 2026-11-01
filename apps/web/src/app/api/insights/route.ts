import { aggregateInsights, isSourceId, type FeedbackRow } from "@travel/core";
import { requireCurator } from "@/lib/auth";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aggregated, anonymized ratings with suggested default weights. Curators only. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireCurator(req);
  const [{ data: rows, error }, { data: cfg }] = await Promise.all([
    ctx.db.from("trip_feedback").select("*").order("updated_at", { ascending: false }).limit(5000),
    ctx.db.from("app_config").select("weights, blocked").eq("id", 1).single(),
  ]);
  if (error) throw error;
  const insights = aggregateInsights((rows ?? []) as FeedbackRow[], cfg?.weights ?? {}, (cfg?.blocked ?? []).filter(isSourceId));
  return json({ insights });
});
