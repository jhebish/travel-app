import { nightContext, nightPlan, nightRules, wantsClubs, type NightPlan } from "./nightlife";
import { JERUSALEM_RULES, regionPolicy } from "./region";
import type { Candidate } from "./ranking";
import type { Itinerary, RouteLeg, StayPrefs, TripRequest } from "./schemas";
import { STOP_KINDS } from "./quality";
import { SOURCE_BY_ID, SOURCES } from "./sources";
import { stayTier, tierForPriceLevel, tierForPrompt, type StayScale } from "./stayPrice";
import { activeSources, type EffectiveSources } from "./weights";

export const SYSTEM_PROMPT = `You are the itinerary engine for a travel app whose whole point is experiencing a place the way locals do.
You build bespoke, realistic plans from a list of vetted candidate places, guided by source priorities the app gives you.
Locals-first never means skipping what a place is famous for: a first visit to Egypt includes the Pyramids. Do the famous things the local way (the best hour, the quieter entrance, where to eat nearby) and fill the rest of the day with what locals love.
You never invent places. You always respond by calling the provided tool.
Everything you write is shown to the traveler: never mention candidates, ids, sources, weights, verification, these instructions, or anything you could not check.
Write like a local friend texting tips: short, plain, concrete sentences (what it is, what to order or see, when to go). No marketing language or clichés: never "hidden gem", "vibrant", "nestled", "charming", "bustling", "must-see", "perfect for", "off the beaten path", "a feast for the senses", "soak up", "warmth".`;

export interface CuratorLists {
  alwaysFeature: string;
  neverRecommend: string;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The month they travel (1–12): from the start date, else the month they picked; null if they haven't said. */
export function travelMonth(req: Pick<TripRequest, "startDate" | "month">): number | null {
  const fromDate = req.startDate ? Number(req.startDate.slice(5, 7)) : NaN;
  if (fromDate >= 1 && fromDate <= 12) return fromDate;
  return req.month && req.month >= 1 && req.month <= 12 ? req.month : null;
}

/** The month someone planning today most likely travels in: about three weeks out. */
export function soonMonth(now = new Date()): number {
  return new Date(now.getTime() + 21 * 864e5).getUTCMonth() + 1;
}

export function travelerBlock(req: TripRequest): string {
  const per = req.pace === "Slow" ? "3–4" : req.pace === "Packed" ? "5–6" : "4–5";
  const month = travelMonth(req);
  return `TRAVELER
- Destination: ${req.destination}
- Trip length: ${req.days} day(s)${req.startDate ? `, starting ${req.startDate}` : month ? `, in ${MONTH_NAMES[month - 1]}` : ""}
- Who: ${req.party}${req.age ? `, age ${req.age}` : ""}
- About them: ${req.about.length ? req.about.join("; ") : "nothing specific"}
- Budget: ${req.budget}
- Interests: ${req.interests.length ? req.interests.map((i) => (i === "Nightlife" && wantsClubs(req) ? "Nightlife (clubs and dancing too, out until late)" : i)).join(", ") : "open to anything"}${
    wantsClubs(req) && !req.interests.includes("Nightlife") ? "\n- Nights: they want clubs and dancing" : ""
  }
- Pace: ${req.pace} (${per} stops per day)
- Notes from the traveler: ${req.extra || "none"}${regionPolicy(req.destination) === "jerusalem" ? `\n\n${JERUSALEM_RULES}` : ""}`;
}

/**
 * A plan, not a list of ideas: every stop is a real place or operator, with its price. The
 * pipeline checks this in code too (quality.ts: vague activities and missing prices are rebuilt).
 */
const CONCRETE_RULES = `- Every stop is one specific place or operator, named as it appears on Google Maps: a café, a museum, a dock, a boat or tour company, a cooking school, a hammam. Never a generic activity like "felucca ride", "sunset cruise" or "walking tour": name where it happens or who runs it, and say where it starts.
- For tours, boat trips, classes and other activities, say in "why" what you do and for how long, and in "localTip" whether to book ahead and how.
- "cost" on every stop, in local currency with a rough US-dollar figure: entry ("EGP 700 entry (~$14)"), an activity per person or per boat ("EGP 500 a boat for an hour (~$10)"), a typical spend for meals and drinks ("~€25 a head", "~€12 a cocktail"), a club's cover, or "Free".`;

/** A day out mixes seeing and doing with eating. The pipeline also checks this in code (quality.ts). */
function dayShape(req: TripRequest): string {
  return `- Make each day a real day out with a mix: things to see or do (sights, museums, markets, parks, walks, viewpoints) between the meals. A typical ${req.pace === "Slow" ? "slow " : ""}day: something to see in the morning, lunch, something to do in the afternoon, then dinner or drinks.
- At most one café or coffee stop a day (two on a packed day), never two in a row, and never three food or drink stops in a row, unless the traveler asked for a food or café day.
${CONCRETE_RULES}
- Give every stop its "kind" (a bar is "drinks"; "nightlife" is a club or a dance night).`;
}

export function sourceBlock(eff: EffectiveSources, lists?: CuratorLists): string {
  const active = activeSources(eff);
  const off = SOURCES.filter((s) => !active.includes(s.id));
  const always = lists ? lines(lists.alwaysFeature) : [];
  const never = lists ? lines(lists.neverRecommend) : [];
  return `SOURCE PRIORITIES (weight 0–10${eff.custom ? ", tuned by this traveler" : ", set by the app's curators"})
Higher weight = a larger share of picks. Spread picks across sources roughly in proportion to weight.
${active.map((id) => `- "${id}" · ${SOURCE_BY_ID[id].name} · weight ${eff.weights[id]}`).join("\n")}
Never use: ${off.length ? off.map((s) => s.name).join(", ") : "none"}.${
    always.length ? `\nAlways feature where relevant:\n${always.map((x) => `- ${x}`).join("\n")}` : ""
  }${never.length ? `\nNever recommend:\n${never.map((x) => `- ${x}`).join("\n")}` : ""}`;
}

/** A candidate's price: a stay's tier for its city ($ to $$$$), else Google's level ($ cheap to $$$$). */
function priceText(c: Candidate): string {
  if (c.category === "stay") {
    const tier = c.priceBand ? stayTier(c.priceBand) : c.priceLevel ? tierForPriceLevel(c.priceLevel) : null;
    return tier ? `· price ${tier} for the city` : "";
  }
  if (c.priceLevel == null) return "";
  return c.priceLevel === 0 ? "· free" : `· price ${"$".repeat(Math.min(4, c.priceLevel))}`;
}

export function candidateBlock(cands: Candidate[]): string {
  if (!cands.length) return "CANDIDATES\n(none supplied: choose well-known, long-established places you are highly confident exist)";
  const fmt = (c: Candidate) =>
    [
      `[${c.id}]`,
      c.name,
      c.neighborhood ? `(${c.neighborhood})` : "",
      `· ${c.category}`,
      `· source:${c.source}`,
      c.stayStyle ? `· ${c.stayStyle}` : "",
      priceText(c),
      c.rating != null ? `· ${c.rating}★ (${c.ratingCount ?? 0})` : "",
      c.tags?.length ? `· tags: ${c.tags.join(", ")}` : "",
      c.note ? `· note: ${c.note}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  return `CANDIDATES (vetted real places, best matches first; ids in brackets)
${cands.map(fmt).join("\n")}`;
}

export function stayRules(stay: StayPrefs, count = 3, scale?: StayScale | null): string {
  return `HOTELS
- Exactly ${count} places to stay. Style: ${stay.styles.length ? stay.styles.join(" or ") : "any"}. Price: ${tierForPrompt(stayTier(stay.price, scale), scale)}.
- Judge price against what hotels cost in this destination, not in a Western capital: a comfortable hotel in Cairo costs a fraction of one in Paris.
- Prefer "stay" candidates; independent and characterful over big chains. Pick neighborhoods that suit this traveler and sit close to where the days happen.
- "nightly" is an approximate USD range for a standard double in a typical season (e.g. "$180–240"). Never claim live availability.`;
}

export function buildTripPrompt(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  candidates: Candidate[],
): string {
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

RULES
- Build the plan mainly from CANDIDATES and set "candidateId" to the bracketed id you used. Favor candidates from higher-weight sources.
- You may add a place that is not a candidate only when no candidate fits and you are highly confident it exists and is open; then set "candidateId" to null and give the source whose kind of recommendation it reflects.
- Tailor everything to the traveler. If they are LGBTQ+, favor welcoming venues and add a practical safety note if the destination warrants it. Respect halal, vegetarian, sober and accessibility needs in every food and venue pick. Suit the age and party.
- Group each day geographically so it is walkable or one short ride. Give realistic times. Mention when a place needs booking, is cash only, or is closed on certain days.
- Include the destination's essential sights for a first visit (what it is famous for), unless their history shows they've been; at most two big sights a day, each with a local angle.
${dayShape(req)}
- Give approximate "lat" and "lng" for every stop and hotel.
- Every "source" must be one of: ${activeSources(eff).join(", ")}.
${req.stay.on ? `\n${stayRules(req.stay)}\n` : ""}
Call submit_itinerary with the finished plan.`;
}


export function buildHotelPromptForAreas(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  areas: string[],
  candidates: Candidate[],
  count = 3,
  scale?: StayScale | null,
): string {
  return `${travelerBlock(req)}

The trip spends time in: ${areas.join(", ") || req.destination}.

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

${stayRules(req.stay, count, scale)}
- Set "candidateId" to the bracketed id you used, or null for a place you are highly confident exists.
- Give approximate "lat" and "lng" for each hotel. "why" under 18 words, "localTip" under 14 words.
- Every "source" must be one of: ${activeSources(eff).join(", ")}.

Call submit_hotels with your ${count === 3 ? "three" : count} picks.`;
}

// ---------------------------------------------------------------------------
// Tool schemas (JSON Schema) for structured output
// ---------------------------------------------------------------------------

const sourceEnum = SOURCES.map((s) => s.id);

const placeProps = {
  name: { type: "string" },
  neighborhood: { type: "string" },
  why: { type: "string", description: "One short, concrete sentence (under 18 words): what it is and what to have or see there." },
  localTip: { type: "string", description: "One practical insider tip (under 14 words)." },
  forYou: { type: "string", description: 'Only when a TASTE section is given and this pick clearly matches it: the favorite of theirs it echoes and where that was ("Because you loved …"), under 12 words. Otherwise empty.' },
  source: { type: "string", enum: sourceEnum },
  candidateId: { type: ["string", "null"], description: "Bracketed candidate id, or null." },
  lat: { type: "number", description: "Approximate latitude of the place." },
  lng: { type: "number", description: "Approximate longitude of the place." },
};

export const HOTEL_JSON_SCHEMA = {
  type: "object",
  properties: {
    ...placeProps,
    style: { type: "string" },
    nightly: { type: "string", description: 'Approximate USD range, e.g. "$180–240".' },
  },
  required: ["name", "neighborhood", "style", "nightly", "why", "localTip", "source", "candidateId"],
} as const;

export const STOP_JSON_SCHEMA = {
  type: "object",
  properties: {
    time: { type: "string", description: '24h, e.g. "09:30"' },
    ...placeProps,
    kind: {
      type: "string",
      enum: [...STOP_KINDS],
      description: "What the stop is: coffee (café, bakery, tea house), meal, drinks (a bar), sight, activity (a tour, boat trip, class…), nature, market, shop or nightlife (a club or dance night).",
    },
    cost: {
      type: "string",
      description: 'What it costs, in local currency with a rough US-dollar figure: "EGP 700 entry (~$14)", "EGP 500 a boat for an hour (~$10)", "~€25 a head", "€20 cover", "Free".',
    },
  },
  required: ["time", "name", "neighborhood", "why", "localTip", "source", "candidateId", "kind", "cost"],
} as const;


export const HOTELS_TOOL = {
  name: "submit_hotels",
  description: "Submit the places to stay.",
  input_schema: {
    type: "object",
    properties: { hotels: { type: "array", items: HOTEL_JSON_SCHEMA } },
    required: ["hotels"],
  },
} as const;

export const STOP_TOOL = {
  name: "submit_stop",
  description: "Submit one replacement stop.",
  input_schema: { type: "object", properties: { stop: STOP_JSON_SCHEMA }, required: ["stop"] },
} as const;

export const DAY_TOOL = {
  name: "submit_day",
  description: "Submit the rebuilt day.",
  input_schema: {
    type: "object",
    properties: {
      theme: { type: "string", description: "Neighborhood or theme." },
      stops: { type: "array", items: STOP_JSON_SCHEMA },
    },
    required: ["theme", "stops"],
  },
} as const;

const dayText = (it: Itinerary, d: number) =>
  it.days[d]!.stops.map((s, i) => `${i + 1}. ${s.time} ${s.name} (${s.neighborhood || "?"})${s.locked ? " [LOCKED]" : ""}`).join("\n");

const elsewhere = (it: Itinerary, d: number) =>
  it.days
    .flatMap((day, i) => (i === d ? [] : day.stops.map((s) => s.name)))
    .concat(it.hotels.map((h) => h.name));

/** Replace one stop: keep the day's flow, avoid every place already in the trip. */
export function buildSwapPrompt(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  it: Itinerary,
  day: number,
  index: number,
  hint: string,
  candidates: Candidate[],
): string {
  const old = it.days[day]!.stops[index]!;
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

THE DAY SO FAR (${it.days[day]!.label}: ${it.days[day]!.theme})
${dayText(it, day)}

TASK
Replace stop ${index + 1} ("${old.name}" at ${old.time}) with a different place that fills the same slot in the day: similar time and role (a meal stays a meal unless asked otherwise), close to the neighboring stops.
- Keep the day balanced: no second café, and no third food or drink stop in a row, unless the traveler asked for it.
${CONCRETE_RULES}
${hint ? `The traveler asked: "${hint}".` : "The traveler wants a different option."}
- Do not suggest ${old.name} or any place already in the trip: ${[...it.days[day]!.stops.map((s) => s.name), ...elsewhere(it, day)].join(", ")}.
- Prefer a candidate (set "candidateId"); otherwise a place you are highly confident exists, with candidateId null.
- Keep the time "${old.time}" unless the new place needs a different time.
- "source" must be one of: ${activeSources(eff).join(", ")}.

Call submit_stop with the replacement.`;
}

/** Rebuild one day, keeping the traveler's locked stops exactly as they are. */
export function buildDayPrompt(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  it: Itinerary,
  day: number,
  hint: string,
  candidates: Candidate[],
  /** A first rebuild failed the day check: what to fix (see quality.ts). */
  fix?: { draft: string; problems: string },
  /** The night-out rules and what tonight holds (see nightlife.ts), when they asked for nightlife. */
  night?: string,
): string {
  const locked = it.days[day]!.stops.filter((s) => s.locked);
  const per = req.pace === "Slow" ? "3–4" : req.pace === "Packed" ? "5–6" : "4–5";
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

CURRENT ${it.days[day]!.label.toUpperCase()} (${it.days[day]!.theme})
${dayText(it, day)}
${night ? `\n${night}\n` : ""}
${fix ? `A FIRST NEW VERSION WAS REJECTED\n${fix.draft}\nWhat was wrong with it:\n${fix.problems}\n\n` : ""}TASK
Build a fresh version of this day with ${per} stops, walkable or one short ride apart, with realistic times.
${hint ? `The traveler asked: "${hint}".` : "Make it meaningfully different from the current version."}
${dayShape(req)}
${
  locked.length
    ? `- Keep these LOCKED stops exactly (same name and time), and plan around them:\n${locked.map((s) => `  - ${s.time} ${s.name}`).join("\n")}`
    : "- No stops are locked."
}
- Do not reuse places from other days: ${elsewhere(it, day).join(", ") || "none"}.
- Prefer candidates (set "candidateId"); otherwise places you are highly confident exist, with candidateId null.
- "source" must be one of: ${activeSources(eff).join(", ")}.

Call submit_day with the theme and stops in time order.`;
}

export const stayLabel = (s: StayPrefs) => `${(s.styles.length ? s.styles.join(" or ") : "any style").toLowerCase()} · ${stayTier(s.price)}`;

// ---------------------------------------------------------------------------
// Fast path: outline first, then every day planned in parallel
// ---------------------------------------------------------------------------

export interface OutlineDay {
  label: string;
  theme: string;
  area: string;
  candidateIds: string[];
  /** Essential sights placed on this day: the day must include them (checked in code). */
  mustSee?: string[];
}
export interface Outline {
  title: string;
  forYou: string;
  notes: string[];
  days: OutlineDay[];
  /** Each day's night (set in code from the request, see nightlife.ts): a club, drinks, or nothing in particular. */
  nights?: NightPlan[];
}

/** The trip's title: plain, never a slogan. */
const TRIP_TITLE = { type: "string", description: 'Plain title naming the place and the angle, under 8 words (e.g. "Porto: tascas and port lodges"). No puns or slogans.' } as const;

/**
 * The trip's one personal line. Only the owner sees it, and only when their history gives a real
 * reason; a general description of the trip is never wanted.
 */
const TRIP_FOR_YOU = {
  type: "string",
  description:
    'Only if TRAVEL HISTORY, TASTE or their thumbs above give a specific reason this trip suits them: one sentence (under 25 words) naming it, e.g. "Built around tascas like the ones you rated five stars in Lisbon." Otherwise an empty string. Never a general description of the trip.',
} as const;

const FOR_YOU_RULE = `- "forYou": empty unless their travel history, taste or thumbs give a specific reason this trip suits them; then one sentence citing it (a place, trip or rating of theirs). Never a general description of the trip.`;

export const OUTLINE_TOOL = {
  name: "submit_outline",
  description: "Submit the trip outline: title, notes, one theme and area per day, and a personal line only when there's a specific reason.",
  input_schema: {
    type: "object",
    properties: {
      title: TRIP_TITLE,
      forYou: TRIP_FOR_YOU,
      notes: { type: "array", items: { type: "string" }, description: "2–3 short practical notes (under 20 words each)." },
      days: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: 'e.g. "Day 1"' },
            theme: { type: "string", description: "Short theme for the day (under 8 words)." },
            area: { type: "string", description: "The neighborhood(s) the day stays in." },
            candidateIds: { type: "array", items: { type: "string" }, description: "Bracketed ids of candidates that fit this day (3–6). Each id used on one day only." },
            mustSee: {
              type: "array",
              items: { type: "string" },
              description: "The essential sights placed on this day, by their usual English name (e.g. \"Pyramids of Giza\"). Empty if none.",
            },
          },
          required: ["label", "theme", "area", "candidateIds", "mustSee"],
        },
      },
    },
    required: ["title", "notes", "days"],
  },
} as const;

/** The most-reviewed sights among the candidates: a strong, objective hint at what a place is famous for. */
export function mostVisitedBlock(cands: Candidate[]): string {
  const top = cands
    .filter((c) => (c.category === "culture" || c.category === "outdoors") && (c.ratingCount ?? 0) >= 1000)
    .sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
    .slice(0, 6);
  if (!top.length) return "";
  return `MOST VISITED SIGHTS HERE (by Google reviews)
${top.map((c) => `- [${c.id}] ${c.name} (${(c.ratingCount ?? 0).toLocaleString("en-US")} reviews)`).join("\n")}`;
}

/** What a first visit can't skip, and how a short trip to a whole country stays in one base. */
function essentialsRules(req: TripRequest): string {
  return `ESSENTIALS
- First decide what ${req.destination} is most famous for that a first-time visitor shouldn't miss: its 1–3 essential sights (e.g. Egypt: the Pyramids of Giza; Rome: the Colosseum; Algiers: the Casbah). Use the most visited sights above and what you know.
- Include them unless the traveler's history shows they've already been to ${req.destination}, or their notes ask to skip famous sights. ${req.days <= 2 ? "This trip is short: the top one or two." : "Up to one per day."}
- Put each in "mustSee" on the day whose area it's in, by its usual English name, and plan that day's area around it.
- If ${req.destination} is a whole country or a large region and the trip is short (1–3 days), base every day in the one city or area where its essentials are (e.g. Egypt in 2 days: Cairo and Giza). Never split a short trip between places hours apart.`;
}

/** Step 1: a quick outline that splits the destination into one area per day and assigns candidates. */
export function buildOutlinePrompt(req: TripRequest, eff: EffectiveSources, lists: CuratorLists, candidates: Candidate[]): string {
  const visited = mostVisitedBlock(candidates);
  const nights = nightPlan(req, req.days);
  const night = nightRules(
    req,
    nights,
    nights.map((_, i) => `Day ${i + 1}`),
  );
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}
${visited ? `\n${visited}\n` : ""}
${essentialsRules(req)}
${night ? `\n${night}\n` : ""}
TASK
Outline a ${req.days}-day trip. Do not plan individual stops yet.
- Give each day a different area (neighborhoods close together, so the day is walkable or one short ride) and a short theme that suits this traveler.
- For each day, list the bracketed ids of 3–6 candidates that belong in that area and fit the traveler: a mix of things to see or do and places to eat, not all cafés or restaurants. Use each id on one day only. Favor higher-weight sources.${
    night ? "\n- Include a bar near the day's area on most days, and a club on each club night." : ""
  }
- Notes: 2–3 short practical tips for this traveler in this place (safety, transit, customs, booking).
${req.about.includes("LGBTQ+ traveler") ? "- If the destination warrants it, include a practical LGBTQ+ safety note.\n" : ""}${FOR_YOU_RULE}

Call submit_outline.`;
}

/** Step 2 (run for every day at once): plan one day's stops inside its area. */
export function buildPlanDayPrompt(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  outline: Outline,
  day: number,
  candidates: Candidate[],
  context = "",
  /** A first draft of this day failed the day check: what to fix (see quality.ts). */
  fix?: { draft: string; problems: string },
): string {
  const d = outline.days[day]!;
  const must = d.mustSee?.filter(Boolean) ?? [];
  const per = req.pace === "Slow" ? "3–4" : req.pace === "Packed" ? "5–6" : "4–5";
  const mine = new Set(d.candidateIds);
  const others = new Set(outline.days.flatMap((x, i) => (i === day ? [] : x.candidateIds)));
  const pool = [...candidates.filter((c) => mine.has(c.id)), ...candidates.filter((c) => !mine.has(c.id) && !others.has(c.id))].slice(0, 30);
  const otherDays = outline.days
    .map((x, i) => (i === day ? null : `${x.label}: ${x.theme} (${x.area})`))
    .filter(Boolean)
    .join("; ");
  const nights = outline.nights ?? [];
  const night = nightRules(
    req,
    nights,
    outline.days.map((x) => x.label),
  );
  const tonight = nightContext(nights, day);
  const dayContext = [context, tonight].filter(Boolean).join("\n");
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(pool)}

TRIP: "${outline.title}"
Other days (planned separately, don't repeat their areas or places): ${otherDays || "none"}
${night ? `\n${night}\n` : ""}
${dayContext ? `CONTEXT FOR THIS DAY\n${dayContext}\n\n` : ""}${
    fix ? `A FIRST DRAFT OF THIS DAY WAS REJECTED\n${fix.draft}\nWhat was wrong with it:\n${fix.problems}\n\n` : ""
  }TASK
Plan ${d.label}: ${d.theme}, in ${d.area}. ${per} stops in time order, walkable or one short ride apart, with realistic 24h times.
${must.length ? `- Must include ${must.join(" and ")}: ${must.length === 1 ? "an essential sight" : "essential sights"} of ${req.destination}. Plan the day around ${must.length === 1 ? "it" : "them"}, with a local angle (best time to go, how to avoid the crowds).\n` : ""}${dayShape(req)}
- Build it mainly from the candidates above and set "candidateId" to the bracketed id; the first ones were picked for this day.
- Otherwise use places you are highly confident exist and are open, with candidateId null.
- Tailor every pick to the traveler: respect halal, vegetarian, sober and accessibility needs; suit the age and party. At most two big sights, each with a local angle.
- Mention booking, cash-only or closing days in the tip when relevant. "why" under 18 words, "localTip" under 14 words.
- "stops" must be a JSON array of objects, not a string.
- Give approximate "lat" and "lng" for every stop.
- "source" must be one of: ${activeSources(eff).join(", ")}.

Call submit_day with the theme and stops.`;
}

// ---------------------------------------------------------------------------
// Multi-city: plan the route first, then every day in parallel
// ---------------------------------------------------------------------------

const TRANSFER_PROPS = {
  mode: { type: "string", description: "e.g. train, flight, ferry, car, sleeper train" },
  duration: { type: "string", description: "Door-to-door estimate, e.g. \"2h 30m\"" },
  note: { type: "string", description: "One practical tip (under 14 words)." },
} as const;

const ALTERNATIVES_PROP = {
  type: "array",
  description: "2–3 other stops that could take this one's slot: close enough that the route still flows, and good in their travel month.",
  items: {
    type: "object",
    properties: {
      city: { type: "string", description: "Town, city or small area." },
      why: { type: "string", description: "How it differs from this stop, under 10 words (e.g. \"Quieter, cheaper, sandier beaches\")." },
    },
    required: ["city", "why"],
  },
} as const;

export const ROUTE_TOOL = {
  name: "submit_route",
  description: "Submit the multi-city route: title, notes, the stops in order with days per stop, and a personal line only when there's a specific reason.",
  input_schema: {
    type: "object",
    properties: {
      title: TRIP_TITLE,
      forYou: TRIP_FOR_YOU,
      notes: { type: "array", items: { type: "string" }, description: "2–3 short practical notes (transport passes, booking ahead, customs)." },
      legs: {
        type: "array",
        description: "The stops in travel order. Their days must add up to the trip length.",
        items: {
          type: "object",
          properties: {
            city: { type: "string", description: "Town, city or small area (e.g. \"Luxor\", \"Sacred Valley\")." },
            region: { type: "string", description: "Region or province, if useful." },
            days: { type: "integer", description: "Whole days spent here, including the arrival day." },
            why: { type: "string", description: "Why this stop suits the traveler (under 18 words)." },
            season: { type: "string", description: "What this stop is like in their travel month, under 14 words (e.g. \"Sea is warm, about 24°C: beach season\")." },
            alternatives: ALTERNATIVES_PROP,
            transfer: {
              type: ["object", "null"],
              description: "How to get here from the previous stop; null for the first stop.",
              properties: TRANSFER_PROPS,
            },
            dayThemes: {
              type: "array",
              description: "One entry per day at this stop, in order.",
              items: {
                type: "object",
                properties: {
                  theme: { type: "string", description: "Short theme (under 8 words)." },
                  area: { type: "string", description: "Neighborhood or area for that day." },
                },
                required: ["theme", "area"],
              },
            },
          },
          required: ["city", "days", "why", "season", "alternatives", "transfer", "dayThemes"],
        },
      },
    },
    required: ["title", "notes", "legs"],
  },
} as const;

/** When they travel, and what that means for where to go. */
export function seasonBlock(req: TripRequest): string {
  const m = travelMonth(req);
  if (!m) {
    return `WHEN
They haven't said when they travel. Choose stops that are good most of the year, and in "season" give each stop's best months in a few words.`;
  }
  const month = MONTH_NAMES[m - 1];
  return `WHEN
They travel in ${month}${req.startDate ? ` (from ${req.startDate})` : ""}. Choose stops that are at their best then:
- Beach, island and swimming stops only where the sea is warm and the season is on in ${month} (ferries running, beach places open). Out of season, go for cities, food towns, hills, hot springs or somewhere with winter sun instead.
- Skip places in monsoon, hurricane or rainy season, extreme heat or cold, or closed for the season, unless the traveler asked for them.
- "season": one line on what ${month} is like at each stop.`;
}

/** Multi-city step 1: choose the stops, their order and days, and a theme for every day. */
export function buildRoutePrompt(req: TripRequest, eff: EffectiveSources, lists: CuratorLists): string {
  const stops = req.days <= 4 ? "2" : req.days <= 7 ? "2–3" : req.days <= 10 ? "3–4" : "4–5";
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${seasonBlock(req)}

TASK
Design a ${req.days}-day multi-stop route through ${req.destination}. Do not plan individual places yet.
- Choose ${stops} stops${req.pace === "Slow" ? " (fewer is better for this slow-paced traveler)" : req.pace === "Packed" ? " (this traveler is happy to move more)" : ""}. Usually at least 2 days per stop; a 1-day stop only for a small place on the way.
- Order them as a sensible line with no backtracking; start and end near a major airport or rail hub when possible.
- Be realistic about transfers: give mode and door-to-door time. A long transfer uses up much of the arrival day.
- Fit the traveler: interests, budget, pace and needs. Favor places locals love over tourist circuits, but a first visit includes what ${req.destination} is famous for (its essential sights): route through them unless their history shows they've been, and name them in that day's theme.
- The stops' "days" must add up to exactly ${req.days}. Give one day theme and area per day at each stop.
- For every stop, 2–3 "alternatives" the traveler could swap in: similar place on the route, also good then, each saying how it differs. Never a stop already on the route.
- Notes: 2–3 practical tips for the whole route.
${NEAR_ISRAEL.test(req.destination) || regionPolicy(req.destination) !== "ok" ? `${ROUTE_REGION_RULE}\n` : ""}${FOR_YOU_RULE}

Call submit_route.`;
}

/** Routes in the region: no stops in Israel (the pipeline also drops any it gets; see region.ts). */
const NEAR_ISRAEL = /palestin|west bank|holy land|levant|middle east|jerusalem|jordan|egypt|sinai|lebanon|syria/i;
const ROUTE_REGION_RULE = "- No stops or alternatives in Israel. Jerusalem and towns in the West Bank are fine.";

// ---------------------------------------------------------------------------
// Multi-city: swap one stop for another town
// ---------------------------------------------------------------------------

export const LEG_TOOL = {
  name: "submit_stop",
  description: "Submit the new stop for this slot of the route: its days, how to get there and on, swaps, and the trip's updated title.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "False if the requested place isn't a real town, city or area you know." },
      city: { type: "string", description: "The town or city as usually written in English." },
      region: { type: "string", description: "Region or province, if useful." },
      why: { type: "string", description: "Why this stop suits the traveler (under 18 words)." },
      season: { type: "string", description: "What it's like there in their travel month, under 14 words." },
      transfer: { type: ["object", "null"], description: "How to get here from the previous stop; null if there is none.", properties: TRANSFER_PROPS },
      nextTransfer: { type: ["object", "null"], description: "How to get from here to the next stop; null if there is none.", properties: TRANSFER_PROPS },
      dayThemes: {
        type: "array",
        description: "One entry per day here, in order.",
        items: {
          type: "object",
          properties: {
            theme: { type: "string", description: "Short theme (under 8 words)." },
            area: { type: "string", description: "Neighborhood or area for that day." },
          },
          required: ["theme", "area"],
        },
      },
      alternatives: ALTERNATIVES_PROP,
      title: { type: "string", description: "The trip's title, updated for the new route: plain, under 8 words, no puns or slogans." },
    },
    required: ["found", "city", "why", "season", "transfer", "nextTransfer", "dayThemes", "alternatives", "title"],
  },
} as const;

/** Swap step 1: the new stop's day themes, transfers and swaps, for the same number of days. */
export function buildLegPrompt(req: TripRequest, route: RouteLeg[], index: number, city: string, days: number, title: string): string {
  const prev = route[index - 1];
  const next = route[index + 1];
  const line = route.map((l, i) => (i === index ? `${city} (new, ${days} days)` : `${l.city} (${l.days} days)`)).join(" → ");
  const others = route.filter((_, i) => i !== index).map((l) => l.city);
  return `${travelerBlock(req)}

${seasonBlock(req)}

ROUTE
"${title}": ${line}.
The traveler is replacing ${route[index]!.city} with ${city}.

TASK
Plan the new stop. Do not plan individual places yet.
- If "${city}" isn't a real place you know, set "found" to false.
- Exactly ${days} day theme${days === 1 ? "" : "s"} with an area each.
- "transfer": ${prev ? `from ${prev.city} to ${city}` : "null (it's the first stop)"}. "nextTransfer": ${next ? `from ${city} to ${next.city}` : "null (it's the last stop)"}. Mode and realistic door-to-door time.
- 2–3 "alternatives" for this slot, other than ${[city, ...others].join(", ")}.
- A new "title" for the whole trip with ${city} in it.

Call submit_stop.`;
}

/** Context line for the first day at a new stop. */
export function arrivalContext(leg: { city: string; transfer?: { mode: string; duration: string; note: string } | null }, from: string): string {
  if (!leg.transfer) return "";
  const t = leg.transfer;
  return `The traveler arrives in ${leg.city} today from ${from} by ${t.mode || "road"}${t.duration ? ` (about ${t.duration})` : ""}. Plan around the arrival: fewer stops, starting after they get in and settle.`;
}
