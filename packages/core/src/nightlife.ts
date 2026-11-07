import { fold } from "./imports/text";
import type { TripRequest } from "./schemas";

/**
 * Nights out. Picking Nightlife means drinks: a wine or cocktail bar near dinner, somewhere to
 * talk. Clubs (dancing until late) are a separate ask, from the "Clubs and dancing" switch or
 * the traveler's own words. Club nights are chosen here, in code, so a trip never stacks them:
 * weekends first when the dates are known, never two in a row, not the last night of a longer
 * trip, and the morning after starts late.
 */

/** Their own words asking to go dancing: "clubbing", "techno", "out dancing". */
const CLUB_WORDS =
  /\b(clubbing|night ?clubs?|techno|house music|raves?|raving|dancing|dance floors?|discos?|discotheques?|party all night|out (late|dancing)|(salsa|tango|bachata) (clubs?|nights?))\b/;

type NightAsk = Pick<TripRequest, "interests" | "party" | "extra"> & { clubs?: boolean };

/** Clubs and dancing: the switch (with Nightlife picked) or their notes say so. Never for a family with kids. */
export function wantsClubs(req: NightAsk): boolean {
  if (req.party === "Family with kids") return false;
  return (!!req.clubs && req.interests.includes("Nightlife")) || CLUB_WORDS.test(fold(req.extra ?? ""));
}

/** Nights out of any kind: Nightlife picked, or clubs asked for. */
export function wantsNightlife(req: NightAsk): boolean {
  if (req.party === "Family with kids") return false;
  return req.interests.includes("Nightlife") || wantsClubs(req);
}

/** Day of the week (0 = Sunday) of trip day `i`, when the start date is known. */
export function tripWeekday(startDate: string | null | undefined, i: number): number | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const d = new Date(`${startDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCDay() + i) % 7;
}

/** All k-element subsets of 0..n-1, in increasing order. */
function* subsets(n: number, k: number, from = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = from; i <= n - (k - acc.length); i++) yield* subsets(n, k, i + 1, [...acc, i]);
}

/**
 * Which nights end at a club (0-based day indexes). One on a trip of up to two days, then about
 * every other night, at most three. Fridays and Saturdays first, then Thursdays, when the start
 * date is known. Never two in a row (the morning after starts late), not the last night of a trip
 * of three days or more (they may travel the next morning), and not the `avoid` nights (days
 * that start with a long transfer).
 */
export function pickClubNights(n: number, opts: { startDate?: string | null; avoid?: readonly number[] } = {}): number[] {
  if (n <= 0) return [];
  const avoid = new Set(opts.avoid ?? []);
  if (n >= 3) avoid.add(n - 1);
  const rank = (i: number) => {
    const w = tripWeekday(opts.startDate, i);
    if (w === null) return 1;
    return w === 5 || w === 6 ? 0 : w === 4 ? 1 : 2;
  };
  // Lower is better, compared in order: weekend nights, then (on longer trips) not the night they
  // arrive, then spread out, then earlier.
  const less = (a: number[], b: number[]) => {
    for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j]! < b[j]!;
    return false;
  };
  for (let want = n <= 2 ? 1 : Math.min(3, Math.floor(n / 2)); want >= 1; want--) {
    let best: number[] | null = null;
    let bestScore: number[] = [];
    for (const s of subsets(n, want)) {
      if (s.some((i) => avoid.has(i)) || s.some((i, j) => j > 0 && i - s[j - 1]! < 2)) continue;
      const gaps = s.slice(1).map((i, j) => i - s[j]!);
      const score = [s.reduce((a, i) => a + rank(i), 0), n >= 3 && s[0] === 0 ? 1 : 0, -(gaps.length ? Math.min(...gaps) : 0), s[0]!];
      if (!best || less(score, bestScore)) {
        best = s;
        bestScore = score;
      }
    }
    if (best) return best;
  }
  return [];
}

/** A club to dance at, from Google's types (or the night pulse, which tags its clubs the same way). */
export const isClubCandidate = (c: { tags?: string[] | null }) => (c.tags ?? []).includes("night_club") && !(c.tags ?? []).includes("restaurant");

export type NightPlan = "club" | "drinks" | null;

/** What each night holds: a club, drinks, or nothing in particular (no nightlife asked for). */
export function nightPlan(req: NightAsk & Pick<TripRequest, "startDate">, n: number, avoid: readonly number[] = []): NightPlan[] {
  if (!wantsNightlife(req)) return Array.from({ length: n }, () => null);
  const clubs = new Set(wantsClubs(req) ? pickClubNights(n, { startDate: req.startDate, avoid }) : []);
  return Array.from({ length: n }, (_, i) => (clubs.has(i) ? "club" : "drinks"));
}

/** The traveler's night-out rules for the outline and day prompts. Empty when they didn't ask for nightlife. */
export function nightRules(req: NightAsk, plan: readonly NightPlan[], labels: readonly string[]): string {
  if (!plan.some(Boolean)) return "";
  const clubDays = plan.flatMap((p, i) => (p === "club" ? [labels[i] ?? `Day ${i + 1}`] : []));
  return `NIGHT OUT
- They're into nightlife: evenings end with a drink at a good bar near dinner (a wine bar, a cocktail bar, a bar locals go to), somewhere to talk. Name the bar.${
    clubDays.length
      ? `
- They also want clubs and dancing. Club nights: ${clubDays.join(", ")}. On those, the day ends at a club where locals actually dance: after dinner and a drink, at the hour it really fills (around midnight in most cities, later in Berlin, Madrid or Buenos Aires), as the last stop. Say in "localTip" when it gets busy, the door policy and what to wear, and in "cost" the cover charge.
- No clubs on the other nights, and the morning after a club night starts late.`
      : `
- No clubs: they didn't ask for dancing until late.`
  }`;
}

/** This day's night, for its prompt. */
export function nightContext(plan: readonly NightPlan[], i: number): string {
  const lines: string[] = [];
  if (i > 0 && plan[i - 1] === "club") lines.push("They were out at a club until late last night: start this day at 11:00 or later, with a late breakfast or brunch, and keep the morning easy.");
  if (plan[i] === "club") lines.push("Tonight is a club night: after dinner and a drink, end the day at a club (see NIGHT OUT), at the hour it fills.");
  else if (plan[i] === "drinks") lines.push("Tonight: a drink at a good bar near dinner. No club.");
  return lines.join("\n");
}
