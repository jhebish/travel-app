import { foldPlace, regionPolicy, suggestKind, type PlaceSuggestion } from "@travel/core";
import { getCtx } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { guessPlaces } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per server instance: map searches one visitor can start a minute (cached letters don't count). */
const PER_MINUTE = 90;
const recent = new Map<string, number[]>();
function allow(id: string): boolean {
  const now = Date.now();
  const list = (recent.get(id) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= PER_MINUTE) return false;
  list.push(now);
  recent.set(id, list);
  if (recent.size > 5000) recent.clear();
  return true;
}

/**
 * The destination box's map suggestions for what's been typed (?q=lisb): cities, regions and
 * countries. The box shows its instant ones (Pylos places, your picks, where you've been) first.
 */
export const GET = handler(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (foldPlace(q).length < 2) return json({ suggestions: [] });
  const ctx = await getCtx(req);
  if (!ctx.user || !allow(ctx.user.id)) return json({ suggestions: [] });
  const guesses = await guessPlaces(q);
  const suggestions: PlaceSuggestion[] = guesses
    .map((g) => ({ label: g.secondary ? `${g.main}, ${g.secondary}` : g.main, name: g.main, sub: g.secondary, kind: suggestKind(g.types) }))
    .filter((s) => regionPolicy(s.label) !== "blocked")
    .slice(0, 6);
  return json({ suggestions });
});
