import { SIGNAL_SOURCES, type SignalSource } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { tasteState } from "@/lib/taste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your taste: the profile Pylos built, whether it's out of date, and the places it learned from. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { inputs, cached, stale, evidence } = await tasteState(ctx);
  const bySource = Object.fromEntries(SIGNAL_SOURCES.map((s) => [s, 0])) as Record<SignalSource, number>;
  for (const s of inputs.signals) bySource[s.source]++;
  return json({
    profile: cached?.profile ?? null,
    stale,
    evidence,
    counts: { total: inputs.signals.length, bySource, pastTrips: inputs.pastTrips.length, thumbs: inputs.feedback.liked.length + inputs.feedback.disliked.length },
    signals: inputs.signals.slice(0, 300),
  });
});
