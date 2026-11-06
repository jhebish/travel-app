import type { RouteLeg } from "./schemas";

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

