import { guessKind, kindFromHints } from "./imports/kind";
import { fold } from "./imports/text";
import type { SignalKind } from "./taste";

/**
 * Day quality: the rules every planned day is checked against before a traveler sees it.
 *
 * Some of what makes a plan right is personal (taste, pace, what they've already done) and comes
 * from their history in the prompts. Some isn't: a day out mixes seeing and doing with eating,
 * doesn't stack four cafés in a row, and a first visit to Egypt includes the Pyramids. Those
 * rules live here, in code, so they hold whatever the model writes: a day that breaks them is
 * rebuilt once with the problems spelled out (see the pipeline's balanceDay).
 */

/** What a stop is for, in the terms a day's mix is judged by. */
export type StopRole = "coffee" | "meal" | "drinks" | "see" | "do" | "shop";

/** The "kind" the model gives each stop. */
export const STOP_KINDS = ["coffee", "meal", "drinks", "sight", "activity", "nature", "market", "shop", "nightlife"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

const ROLE_OF_KIND: Record<StopKind, StopRole> = {
  coffee: "coffee",
  meal: "meal",
  drinks: "drinks",
  nightlife: "drinks",
  sight: "see",
  nature: "see",
  activity: "do",
  market: "do",
  shop: "shop",
};

const ROLE_OF_SIGNAL: Record<SignalKind, StopRole> = {
  coffee: "coffee",
  food: "meal",
  drink: "drinks",
  nightlife: "drinks",
  sight: "see",
  activity: "do",
  shop: "shop",
  stay: "see",
  city: "see",
};

const isFood = (r: StopRole) => r === "coffee" || r === "meal" || r === "drinks";

/**
 * A stop's role. Google's place types are the most reliable signal (a "cafe" is a café whatever
 * the model calls it), then the model's own "kind", then keywords in the name.
 */
export function stopRole(stop: { name: string; kind?: string | null }, hints: readonly string[] = []): StopRole {
  const hinted = hints.length ? kindFromHints(hints) : null;
  if (hinted) return ROLE_OF_SIGNAL[hinted];
  if (stop.kind && stop.kind in ROLE_OF_KIND) return ROLE_OF_KIND[stop.kind as StopKind];
  return ROLE_OF_SIGNAL[guessKind(stop.name)];
}

/** Words too general to tell two sights apart ("museum", "palace"…), and joining words. */
const GENERIC = new Set(
  (
    "the of and de del la le les el al an der die das di da do dos das du des " +
    "museum museo musee palace palais palacio park parc parque garden gardens jardin mosque masjid church cathedral basilica " +
    "market souk tower square plaza piazza street road beach castle fort fortress temple shrine bridge old new city national " +
    "great grand royal saint st san santa santo house center centre district quarter complex site gate"
  ).split(" "),
);
const sightWords = (s: string) =>
  fold(s)
    .split(" ")
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

/**
 * True when two names point at the same sight: they share a telling word, ignoring generic ones
 * and plurals. "Pyramids of Giza" = "Great Pyramid of Giza" = "Giza Pyramid Complex";
 * "Egyptian Museum" ≠ "Coptic Museum".
 */
export function sameSight(a: string, b: string): boolean {
  const wa = sightWords(a);
  const wb = new Set(sightWords(b));
  if (!wa.length || !wb.size) return fold(a) === fold(b);
  return wa.some((w) => wb.has(w));
}

export interface DayCheckOptions {
  /** The essentials this day must include (from the outline). */
  mustSee?: readonly string[];
  /** The traveler asked for a food or café day: relax the eating limits. */
  foodFocus?: boolean;
  coffeeFocus?: boolean;
}

export type DayIssueCode = "coffee" | "coffee_in_a_row" | "few_sights" | "food_in_a_row" | "must_see";
export interface DayIssue {
  code: DayIssueCode;
  /** What to tell the model when rebuilding the day. */
  fix: string;
}

const FOOD_WORDS = /\b(food|foodie|eat|eating|tasting|culinary|restaurants?|street food|cooking)\b/i;
const COFFEE_WORDS = /\b(coffee|cafes?|cafés?|espresso|roasters?|bakery|bakeries|pastr(y|ies)|patisseries?)\b/i;

/** Read what the traveler asked for (notes, interests, a rebuild hint) into the check's options. */
export function dayCheckOptions(texts: readonly string[], mustSee: readonly string[] = []): DayCheckOptions {
  const all = texts.join(" ");
  return { mustSee, foodFocus: FOOD_WORDS.test(all), coffeeFocus: COFFEE_WORDS.test(all) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Problems with one day's plan, in the order its stops happen. Empty when the day is fine.
 * Short days (an arrival or departure day with one or two stops) are only checked for repeats.
 */
export function checkDay(stops: readonly { name: string; role: StopRole }[], opts: DayCheckOptions = {}): DayIssue[] {
  const issues: DayIssue[] = [];
  const n = stops.length;
  const roles = stops.map((s) => s.role);

  const coffees = roles.filter((r) => r === "coffee").length;
  const coffeeMax = opts.coffeeFocus ? 3 : n >= 6 ? 2 : 1;
  if (coffees > coffeeMax) {
    issues.push({ code: "coffee", fix: `It has ${plural(coffees, "café or coffee stop")}. Keep at most ${coffeeMax}.` });
  } else if (!opts.coffeeFocus && roles.some((r, i) => r === "coffee" && roles[i + 1] === "coffee")) {
    issues.push({ code: "coffee_in_a_row", fix: "It has two cafés back to back. Never put two coffee stops in a row." });
  }

  const seeDo = roles.filter((r) => !isFood(r)).length;
  // A food or café day the traveler asked for still gets one break from eating on a long day.
  const focus = opts.foodFocus || opts.coffeeFocus;
  const needed = focus ? (n >= 5 ? 1 : 0) : n >= 5 ? 2 : n >= 3 ? 1 : 0;
  if (seeDo < needed) {
    issues.push({
      code: "few_sights",
      fix: `It has ${seeDo ? `only ${plural(seeDo, "thing")}` : "nothing"} to see or do between the meals. Include at least ${plural(needed, "thing")} to see or do (a sight, museum, market, park, walk or viewpoint), spread between the meals.`,
    });
  }

  if (!opts.foodFocus && !opts.coffeeFocus && roles.some((r, i) => isFood(r) && isFood(roles[i + 1] ?? "see") && isFood(roles[i + 2] ?? "see"))) {
    issues.push({ code: "food_in_a_row", fix: "It has three food or drink stops in a row. Alternate eating with seeing and doing." });
  }

  for (const sight of opts.mustSee ?? []) {
    if (!stops.some((s) => sameSight(s.name, sight))) {
      issues.push({ code: "must_see", fix: `It leaves out ${sight}, which this day was meant to include. Include it, with a local angle (best time to go, how to avoid the crowds).` });
    }
  }
  return issues;
}

/** The instruction for rebuilding a day that failed the check. */
export function dayFixText(issues: readonly DayIssue[]): string {
  return `${issues.map((i) => `- ${i.fix}`).join("\n")}
- Keep what was good about it (the area, the best picks), keep lunch and dinner at real meal times, and keep the stops walkable or one short ride apart.`;
}
