import { haversineKm, type LatLng } from "./geo";
import { guessKind, kindFromHints } from "./imports/kind";
import { fold } from "./imports/text";
import type { Candidate } from "./ranking";
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

/** What a stop is for, in the terms a day's mix is judged by. "club": dancing until late. */
export type StopRole = "coffee" | "meal" | "drinks" | "club" | "see" | "do" | "shop";

/** The "kind" the model gives each stop. "nightlife" is a club or a dance night; a bar is "drinks". */
export const STOP_KINDS = ["coffee", "meal", "drinks", "sight", "activity", "nature", "market", "shop", "nightlife"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

const ROLE_OF_KIND: Record<StopKind, StopRole> = {
  coffee: "coffee",
  meal: "meal",
  drinks: "drinks",
  nightlife: "club",
  sight: "see",
  nature: "see",
  activity: "do",
  market: "do",
  shop: "shop",
};

/** From Google's types. Its "nightlife" also covers theaters and cinemas: a show is something to do; clubs are told apart by "night_club". */
const ROLE_OF_SIGNAL: Record<SignalKind, StopRole> = {
  coffee: "coffee",
  food: "meal",
  drink: "drinks",
  nightlife: "do",
  sight: "see",
  activity: "do",
  shop: "shop",
  stay: "see",
  city: "see",
};

const isFood = (r: StopRole) => r === "coffee" || r === "meal" || r === "drinks";
/** Something to see or do (not eating, drinking or dancing). */
const isSeeDo = (r: StopRole) => r === "see" || r === "do" || r === "shop";

/**
 * Bakeries, pâtisseries, ice cream and tea rooms: food to the importers, but in a day's mix a
 * break like a café, not a meal. Matched against folded names and Google types ("ice_cream_shop").
 */
const SNACK =
  /\b(bakery|bakeries|bakehouse|boulangerie|patisseries?|pasticceria|pasteleria|pastelaria|konditorei|confeitaria|pastry|pastries|dessert( shop)?|ice cream( shop)?|gelateria|gelato|tea (house|room)|teahouse|creperie|(donut|doughnut|chocolate) shop|chocolatier|confectionery)\b/;
const isSnack = (texts: readonly string[]) => texts.some((t) => SNACK.test(fold(t)));

/**
 * A stop's role. Google's place types are the most reliable signal (a "cafe" is a café whatever
 * the model calls it), then the model's own "kind", then keywords in the name.
 */
export function stopRole(stop: { name: string; kind?: string | null }, hints: readonly string[] = []): StopRole {
  if (hints.includes("night_club") && !hints.includes("restaurant")) return stop.kind === "drinks" ? "drinks" : "club";
  const hinted = hints.length ? kindFromHints(hints) : null;
  if (hinted) {
    const role = ROLE_OF_SIGNAL[hinted];
    return role === "meal" && isSnack([...hints, stop.name]) ? "coffee" : role;
  }
  if (stop.kind && stop.kind in ROLE_OF_KIND) return ROLE_OF_KIND[stop.kind as StopKind];
  const guessed = ROLE_OF_SIGNAL[guessKind(stop.name)];
  return guessed === "meal" && isSnack([stop.name]) ? "coffee" : guessed;
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
  /** The traveler asked for a food day ("a food tour", "we're foodies"): three eating stops may run in a row, and fewer sights are needed. */
  foodFocus?: boolean;
  /** The traveler asked for a café day ("a coffee crawl"): up to four cafés, back to back. */
  coffeeFocus?: boolean;
  /** The traveler mentioned coffee: two cafés a day are fine (still not back to back). */
  coffeeLover?: boolean;
  /** Tonight ends at a club (see nightlife.ts). Only checked when there's a club to choose from. */
  clubNight?: boolean;
  /** They were at a club last night: the day starts late. */
  lateStart?: boolean;
  /** Words naming the destination ("Cairo", "Egypt"): no help in telling a vague activity from a real place. */
  place?: string;
}

export type DayIssueCode =
  | "coffee"
  | "coffee_in_a_row"
  | "few_sights"
  | "food_in_a_row"
  | "must_see"
  | "vague_activity"
  | "no_price"
  | "club_timing"
  | "no_club"
  | "early_start";

/** A planned stop as the day check sees it. */
export interface CheckedStop {
  name: string;
  role: StopRole;
  /** "HH:MM" */
  time?: string;
  /** The model's kind ("activity", "sight"…). */
  kind?: string | null;
  cost?: string | null;
  /** Picked from the candidates: a real place found by a search or vetted by a local. */
  grounded?: boolean;
}
export interface DayIssue {
  code: DayIssueCode;
  /** What to tell the model when rebuilding the day. */
  fix: string;
}

// Matched against folded text (lowercase, no accents or punctuation: "Café-hopping!" → "cafe hopping").
/** An explicit ask for a food day. */
const FOOD_DAY = /\b(foodies?|culinary|gastronom\w*|food (tours?|trips?|crawls?|days?|walks?|lovers?|focused|holiday|scene)|eat(ing)? (our|my|their|your) way|tasting (tours?|menus?)|street food)\b/;
/** An explicit ask for a café day. */
const COFFEE_DAY = /\b(coffee|cafes?|espresso|bakery|bakeries|pastry|pastries|patisseries?) (crawls?|tours?|hopping|hops?|days?|trips?|walks?)\b/;
const FOOD_WORDS = /\b(food|foodie|eat|eating|tasting|culinary|restaurants?|street food|cooking)\b/;
const COFFEE_WORDS = /\b(coffee|cafes?|espresso|roasters?|bakery|bakeries|pastry|pastries|patisseries?)\b/;

/**
 * Read what the traveler asked for into the check's options. Only their own words count, the
 * trip's notes and the hint when they rebuild a day, never the interest chips: picking "Food"
 * means they care about eating well, not that a day can be all meals.
 * - Notes relax the rules only for an explicit food or café day ("a food tour", "a coffee
 *   crawl"). Mentioning coffee allows a second café. ("We don't eat pork" changes nothing.)
 * - A rebuild hint is a direct ask for that one day: any food or coffee word relaxes them.
 */
export function dayCheckOptions(ask: { notes?: string | null; hint?: string | null }, mustSee: readonly string[] = []): DayCheckOptions {
  const notes = fold(ask.notes ?? "");
  const hint = fold(ask.hint ?? "");
  return {
    mustSee,
    foodFocus: FOOD_DAY.test(notes) || FOOD_WORDS.test(hint),
    coffeeFocus: COFFEE_DAY.test(notes) || COFFEE_WORDS.test(hint),
    coffeeLover: COFFEE_WORDS.test(notes),
  };
}

/** The longest run of consecutive stops that pass `test`. */
function longestRun<T>(items: readonly T[], test: (t: T) => boolean): number {
  let best = 0;
  let run = 0;
  for (const t of items) {
    run = test(t) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Words that only describe an activity or its setting, never who runs it or where it starts:
 * "Felucca ride on the Nile", "Old town walking tour", "Sunset cruise". (Matched folded.)
 */
const ACTIVITY_ONLY = new Set(
  (
    "a an the on in at of to for from by with and or along around through across over under near into onto up down off out " +
    "sunset sunrise morning afternoon evening night day half full late early hour hours minute minutes " +
    "private guided self local traditional classic authentic small large group shared quick short long easy scenic historic old new " +
    "great grand little best famous real typical " +
    "ride rides riding cruise cruises cruising tour tours touring trip trips class classes lesson lessons course workshop workshops " +
    "walk walks walking stroll hike hikes hiking trek treks trekking sail sails sailing boat boats boating felucca feluccas dhow dhows " +
    "gondola gondolas kayak kayaking canoe canoeing paddle paddling paddleboard paddleboarding sup snorkel snorkeling snorkelling " +
    "dive dives diving scuba swim swimming surf surfing bike bikes biking cycling cycle bicycle ebike segway scooter vespa jeep jeeps " +
    "quad quads atv buggy buggies safari safaris camel camels horse horses horseback carriage tuk tuktuk rickshaw tram cable car " +
    "funicular balloon balloons hot air helicopter flight flights zipline zip line climb climbing excursion excursions experience " +
    "experiences adventure adventures visit visits view views viewing watching spotting tasting tastings food foods street wine wines " +
    "beer beers coffee tea cooking pottery craft crafts dance dancing salsa tango flamenco music show shows concert performance " +
    "massage spa hammam bath baths yoga market markets shopping crawl pub bar photo photography sightseeing explore exploring " +
    "river rivers nile seine thames danube tiber bosphorus ganges mekong amazon hudson rhine douro tagus arno " +
    "lake lakes sea ocean bay harbour harbor port coast coastal beach beaches island islands canal canals lagoon " +
    "town city center centre downtown medina souk souks bazaar bazaars quarter neighborhood neighbourhood district " +
    "desert dunes mountain mountains valley waterfall waterfalls cave caves forest jungle park parks garden gardens countryside vineyard vineyards"
  ).split(" "),
);

/**
 * True when a stop names only an activity ("Felucca ride on the Nile"), not a place or an operator
 * someone could find and book. `place` is the destination: its name doesn't make a stop specific.
 */
export function isVagueActivity(name: string, place = ""): boolean {
  const placeWords = new Set(fold(place).split(" "));
  const words = fold(name)
    .split(" ")
    .filter((w) => w.length > 1);
  return words.length > 0 && words.every((w) => ACTIVITY_ONLY.has(w) || placeWords.has(w) || /^\d+$/.test(w));
}

/** Minutes after the morning starts (times before 06:00 count as late the night before). */
function minutesOf(time: string | undefined): number | null {
  const m = /^(\d{1,2})[:.h](\d{2})/.exec((time ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return (h < 6 ? h + 24 : h) * 60 + min;
}
/** From 21:00 the day is a night out: drinks after dinner aren't "eating in a row". */
const NIGHT = 21 * 60;
const isNight = (s: CheckedStop) => (minutesOf(s.time) ?? 0) >= NIGHT;

/**
 * Problems with one day's plan, in the order its stops happen. Empty when the day is fine.
 * Short days (an arrival or departure day with one or two stops) are only checked for repeats.
 */
export function checkDay(stops: readonly CheckedStop[], opts: DayCheckOptions = {}): DayIssue[] {
  const issues: DayIssue[] = [];
  const n = stops.length;
  const roles = stops.map((s) => s.role);
  // The daytime part of the day: the night out (from 21:00) is judged on its own.
  const daytime = stops.filter((s) => !isNight(s));

  const coffees = roles.filter((r) => r === "coffee").length;
  const coffeeMax = opts.coffeeFocus ? 4 : opts.coffeeLover || n >= 6 ? 2 : 1;
  if (coffees > coffeeMax) {
    issues.push({ code: "coffee", fix: `It has ${plural(coffees, "café or coffee stop")}. Keep at most ${coffeeMax}.` });
  } else if (!opts.coffeeFocus && roles.some((r, i) => r === "coffee" && roles[i + 1] === "coffee")) {
    issues.push({ code: "coffee_in_a_row", fix: "It has two cafés back to back. Never put two coffee stops in a row." });
  }

  const seeDo = roles.filter(isSeeDo).length;
  const d = daytime.length;
  // A food or café day the traveler asked for still gets one break from eating on a long day.
  const focus = opts.foodFocus || opts.coffeeFocus;
  const needed = focus ? (d >= 5 ? 1 : 0) : d >= 5 ? 2 : d >= 3 ? 1 : 0;
  if (seeDo < needed) {
    issues.push({
      code: "few_sights",
      fix: `It has ${seeDo ? `only ${plural(seeDo, "thing")}` : "nothing"} to see or do between the meals. Include at least ${plural(needed, "thing")} to see or do (a sight, museum, market, park, walk or viewpoint), spread between the meals.`,
    });
  }

  // Eating stops in a row: three is too many on a normal day, four on a food day. A café crawl is
  // eating stops by design, and so is a night out after dinner.
  const eating = longestRun(daytime.map((s) => s.role), isFood);
  if (!opts.coffeeFocus && eating >= (opts.foodFocus ? 4 : 3)) {
    issues.push({ code: "food_in_a_row", fix: `It has ${eating} food or drink stops in a row. Put something to see or do between the meals.` });
  }

  for (const sight of opts.mustSee ?? []) {
    if (!stops.some((s) => sameSight(s.name, sight))) {
      issues.push({ code: "must_see", fix: `It leaves out ${sight}, which this day was meant to include. Include it, with a local angle (best time to go, how to avoid the crowds).` });
    }
  }

  // A plan, not an idea: every activity is somewhere real, with its price.
  for (const s of stops) {
    // By the model's own kind: older stops (kept or locked) have none and aren't held to it.
    const activity = s.kind === "activity";
    if (activity && !s.grounded && isVagueActivity(s.name, opts.place)) {
      issues.push({
        code: "vague_activity",
        fix: `"${s.name}" is an activity, not a place. Name the dock, boat company, tour operator, school or venue where it happens, as it appears on Google Maps (a candidate if one fits), and say where it starts.`,
      });
    }
    if ((activity || s.kind === "nightlife") && !s.cost?.trim()) {
      issues.push({ code: "no_price", fix: `Give "${s.name}" its ${activity ? "price" : "cover charge"} in "cost", in local currency with a rough US-dollar figure.` });
    }
  }

  // Clubs fill late: after dinner and a drink, and nothing to see or do after.
  const club = stops.findIndex((s) => s.role === "club");
  if (club >= 0) {
    const at = minutesOf(stops[club]!.time);
    const after = stops.slice(club + 1).some((s) => !isFood(s.role) && s.role !== "club");
    if ((at !== null && at < 22 * 60) || after) {
      issues.push({ code: "club_timing", fix: `${stops[club]!.name} is a club: put it last, after dinner and a drink, at the hour it fills (around midnight, later where the city goes out late).` });
    }
  } else if (opts.clubNight) {
    issues.push({ code: "no_club", fix: "Tonight was meant to end at a club: after dinner and a drink, add one (from the candidates) as the last stop, at the hour it fills." });
  }
  const start = minutesOf(stops[0]?.time);
  if (opts.lateStart && start !== null && start < 10 * 60 + 30) {
    issues.push({ code: "early_start", fix: "They were at a club until late last night: start this day at 11:00 or later, with a late breakfast or brunch." });
  }
  return issues;
}

/** The instruction for rebuilding a day that failed the check. */
export function dayFixText(issues: readonly DayIssue[]): string {
  return `${issues.map((i) => `- ${i.fix}`).join("\n")}
- Keep what was good about it (the area, the best picks), keep lunch and dinner at real meal times, and keep the stops walkable or one short ride apart.`;
}

/** Sights with at least this many Google reviews are what a place is famous for. */
export const FAMOUS_REVIEWS = 20_000;
/** A sight can join a day whose other places are within this distance. */
const NEAR_KM = 40;

/**
 * What a place is famous for, most reviewed first: culture or outdoors candidates with a following
 * on Google that only headline sights have (the Pyramids of Giza, the Colosseum). Two listings of
 * the same sight count once.
 */
export function famousSights(cands: readonly Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  const sorted = cands
    .filter((c) => (c.category === "culture" || c.category === "outdoors") && (c.ratingCount ?? 0) >= FAMOUS_REVIEWS)
    .sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
  for (const c of sorted) if (!out.some((o) => sameSight(o.name, c.name))) out.push(c);
  return out;
}

export interface LandmarkOptions {
  /** Days in this stretch of the trip: 1–2 days get the top sight, 3–4 the top two, longer the top three. */
  days: number;
  /** Days to use only when no other day is near (an arrival day). */
  avoid?: readonly number[];
}

const located = (c: Candidate | undefined): LatLng | null =>
  c?.verification?.lat != null && c.verification.lng != null ? { lat: c.verification.lat, lng: c.verification.lng } : null;

/**
 * Make sure a trip includes what its place is famous for (the Pyramids on two days in Egypt).
 * The outline is asked for these essentials, but the fast model writes it, so its answer is checked
 * here, in code: each of the place's most-reviewed sights that's within reach of a planned day and
 * isn't yet any day's must-see becomes a must-see of the day the outline gave it, or else of the
 * nearest day. The day check then holds that day to it. Sights far from every day (Luxor on a
 * Cairo trip) are left out and don't count. Don't use it for a traveler who has been before (see
 * isReturnVisit): they get places a first-timer wouldn't know instead.
 */
export function ensureLandmarks<D extends { candidateIds: string[]; mustSee?: string[] }>(
  days: readonly D[],
  cands: readonly Candidate[],
  opts: LandmarkOptions,
): { days: D[]; added: string[] } {
  const out = days.map((d) => ({ ...d, candidateIds: [...d.candidateIds], mustSee: [...(d.mustSee ?? [])] }));
  const added: string[] = [];
  const byId = new Map(cands.map((c) => [c.id, c]));
  let wanted = opts.days <= 2 ? 1 : opts.days <= 4 ? 2 : 3;
  for (const sight of famousSights(cands)) {
    if (wanted <= 0 || !out.length) break;
    if (out.some((d) => d.mustSee.some((m) => sameSight(m, sight.name)))) {
      wanted--;
      continue;
    }
    const at = located(sight);
    // How far each day is from the sight: 0 for the day the outline gave it to.
    const dist = out.map((d) => {
      if (d.candidateIds.some((id) => id === sight.id || sameSight(byId.get(id)?.name ?? "", sight.name))) return 0;
      if (!at) return Number.POSITIVE_INFINITY;
      const near = d.candidateIds.map((id) => located(byId.get(id))).filter((p): p is LatLng => !!p);
      return near.length ? Math.min(...near.map((p) => haversineKm(at, p))) : Number.POSITIVE_INFINITY;
    });
    const avoided = (i: number) => (opts.avoid?.includes(i) ? 1 : 0);
    const pick = out
      .map((_, i) => i)
      .filter((i) => dist[i]! <= NEAR_KM && out[i]!.mustSee.length < 3)
      .sort((a, b) => avoided(a) - avoided(b) || dist[a]! - dist[b]!)[0];
    if (pick === undefined) continue;
    out[pick]!.mustSee.push(sight.name);
    if (!out[pick]!.candidateIds.includes(sight.id)) out[pick]!.candidateIds.push(sight.id);
    // Planned on that day only: on two days it would be dropped from one as a repeat.
    out.forEach((d, i) => {
      if (i !== pick) d.candidateIds = d.candidateIds.filter((id) => id !== sight.id);
    });
    added.push(sight.name);
    wanted--;
  }
  return { days: out as unknown as D[], added };
}
