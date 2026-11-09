import { SIGNAL_SOURCES, habitLines, travelHabits, type SignalSource } from "@travel/core";
import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { tasteState } from "@/lib/taste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your taste: the profile Pylos built, whether it's out of date, the places it learned from, and
 * `habits`: how you travel, counted from your past trips ("24 trips since 2020, about 4 a year.").
 */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { inputs, cached, stale, evidence } = await tasteState(ctx);
  const bySource = Object.fromEntries(SIGNAL_SOURCES.map((s) => [s, 0])) as Record<SignalSource, number>;
  for (const s of inputs.signals) bySource[s.source]++;
  const habits = habitLines(travelHabits(inputs.pastTrips.filter((t) => t.countryCode)));
  return json({
    profile: cached?.profile ?? null,
    stale,
    evidence,
    habits,
    counts: { total: inputs.signals.length, bySource, pastTrips: inputs.pastTrips.length, thumbs: inputs.feedback.liked.length + inputs.feedback.disliked.length },
    signals: inputs.signals.slice(0, 300),
  });
});
