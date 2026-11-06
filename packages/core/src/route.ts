import type { Itinerary, RouteLeg } from "./schemas";

/** Make the route's day counts add up to the trip length, and give every day a theme. */
export function fitRoute(legs: RouteLeg[], days: number): RouteLeg[] {
  let out = legs.filter((l) => l.city.trim()).map((l) => ({ ...l, days: Math.max(1, Math.round(l.days)) }));
  if (!out.length) return out;
  // Too many stops for the time: drop from the end (keep at least one).
  while (out.length > 1 && out.length > days) out = out.slice(0, -1);
  let total = out.reduce((n, l) => n + l.days, 0);
  // Too long: take days from the longest stops. Too short: add to the longest stops.
  while (total > days) {
    const i = out.reduce((best, l, j) => (l.days > out[best]!.days ? j : best), 0);
    if (out[i]!.days <= 1) break;
    out[i] = { ...out[i]!, days: out[i]!.days - 1 };
    total--;
  }
  while (total < days) {
    const i = out.reduce((best, l, j) => (l.days > out[best]!.days ? j : best), 0);
    out[i] = { ...out[i]!, days: out[i]!.days + 1 };
    total++;
  }
  return out.map((l, i) => ({
    ...l,
    transfer: i === 0 ? null : l.transfer ?? null,
    dayThemes: Array.from({ length: l.days }, (_, k) => l.dayThemes[k] ?? { theme: k === 0 ? `Arriving in ${l.city}` : `More of ${l.city}`, area: l.city }),
  }));
}


/**
 * The same trip, shorter, for a days slider. Whole days are kept so each still makes sense.
 * One place: the first `n` days. Several stops: the first stops on the route (about two days
 * each), with the days shared out in proportion to the original plan.
 */
export function fitItineraryToDays(it: Itinerary, n: number): Itinerary {
  const total = it.days.length;
  if (!Number.isFinite(n) || n >= total || n < 1) return it;
  const relabel = (days: Itinerary["days"]) => days.map((d, i) => ({ ...d, label: `Day ${i + 1}` }));
  const legs = it.route ?? [];
  if (it.mode !== "multi" || legs.length < 2) return { ...it, days: relabel(it.days.slice(0, n)) };

  const legDays = legs.map((l) => it.days.filter((d) => d.city === l.city));
  const capacity = (k: number) => legDays.slice(0, k).reduce((s, d) => s + d.length, 0);
  let keep = Math.max(1, Math.min(legs.length, Math.floor(n / 2)));
  while (keep < legs.length && capacity(keep) < n) keep++;
  const kept = legs.slice(0, keep);
  const caps = legDays.slice(0, keep).map((d) => d.length);
  const want = kept.map((l, i) => Math.max(1, Math.min(l.days, caps[i]!)));
  const sum = want.reduce((a, b) => a + b, 0);
  const exact = want.map((w) => (w / sum) * n);
  const alloc = exact.map((x, i) => Math.max(1, Math.min(caps[i]!, Math.floor(x))));
  let diff = n - alloc.reduce((a, b) => a + b, 0);
  while (diff > 0) {
    let best = -1;
    for (let i = 0; i < keep; i++) if (alloc[i]! < caps[i]! && (best < 0 || exact[i]! - alloc[i]! > exact[best]! - alloc[best]!)) best = i;
    if (best < 0) break;
    alloc[best]!++;
    diff--;
  }
  while (diff < 0) {
    let best = -1;
    for (let i = 0; i < keep; i++) if (alloc[i]! > 1 && (best < 0 || exact[i]! - alloc[i]! < exact[best]! - alloc[best]!)) best = i;
    if (best < 0) break;
    alloc[best]!--;
    diff++;
  }
  const keptCities = new Set(kept.map((l) => l.city));
  return {
    ...it,
    days: relabel(legDays.slice(0, keep).flatMap((d, i) => d.slice(0, alloc[i]))),
    route: kept.map((l, i) => ({ ...l, days: alloc[i]! })),
    hotels: (it.hotels ?? []).filter((h) => !h.city || keptCities.has(h.city)),
  };
}
