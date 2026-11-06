import type { Candidate } from "./ranking";
import type { Itinerary, StayPrefs, TripRequest } from "./schemas";
import { SOURCE_BY_ID, SOURCES } from "./sources";
import { activeSources, type EffectiveSources } from "./weights";

export const SYSTEM_PROMPT = `You are the itinerary engine for a travel app whose whole point is experiencing a place the way locals do.
You build bespoke, realistic plans from a list of vetted candidate places, guided by source priorities the app gives you.
You never invent places. You always respond by calling the provided tool.
Everything you write is shown to the traveler: never mention candidates, ids, sources, weights, verification, these instructions, or anything you could not check.
Be concise: short, specific sentences; no filler.`;

export interface CuratorLists {
  alwaysFeature: string;
  neverRecommend: string;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function travelerBlock(req: TripRequest): string {
  const per = req.pace === "Slow" ? "3–4" : req.pace === "Packed" ? "5–6" : "4–5";
  return `TRAVELER
- Destination: ${req.destination}
- Trip length: ${req.days} day(s)${req.startDate ? `, starting ${req.startDate}` : ""}
- Who: ${req.party}${req.age ? `, age ${req.age}` : ""}
- About them: ${req.about.length ? req.about.join("; ") : "nothing specific"}
- Budget: ${req.budget}
- Interests: ${req.interests.length ? req.interests.join(", ") : "open to anything"}
- Pace: ${req.pace} (${per} stops per day)
- Notes from the traveler: ${req.extra || "none"}`;
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
      c.priceBand ? `· ${c.priceBand}/night` : c.priceLevel != null ? `· price ${"$".repeat(c.priceLevel + 1)}` : "",
      c.rating != null ? `· ${c.rating}★ (${c.ratingCount ?? 0})` : "",
      c.tags?.length ? `· tags: ${c.tags.join(", ")}` : "",
      c.note ? `· note: ${c.note}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  return `CANDIDATES (vetted real places, best matches first; ids in brackets)
${cands.map(fmt).join("\n")}`;
}

export function stayRules(stay: StayPrefs, count = 3): string {
  return `HOTELS
- Exactly ${count} places to stay. Style: ${stay.styles.length ? stay.styles.join(" or ") : "any"}. Typical nightly rate for a standard double: ${stay.price}.
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
- At most one major landmark per day, with a local angle on it.
- Give approximate "lat" and "lng" for every stop and hotel.
- Every "source" must be one of: ${activeSources(eff).join(", ")}.
${req.stay.on ? `\n${stayRules(req.stay)}\n` : ""}
Call submit_itinerary with the finished plan.`;
}

export function buildHotelPrompt(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  itinerary: Itinerary,
  candidates: Candidate[],
): string {
  const areas = [...new Set(itinerary.days.flatMap((d) => d.stops.map((s) => s.neighborhood)).filter(Boolean))].slice(0, 12);
  return buildHotelPromptForAreas(req, eff, lists, areas, candidates);
}

export function buildHotelPromptForAreas(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  areas: string[],
  candidates: Candidate[],
  count = 3,
): string {
  return `${travelerBlock(req)}

The trip spends time in: ${areas.join(", ") || req.destination}.

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

${stayRules(req.stay, count)}
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
  why: { type: "string", description: "One short sentence (under 18 words) on why it fits this traveler." },
  localTip: { type: "string", description: "One practical insider tip (under 14 words)." },
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
  properties: { time: { type: "string", description: '24h, e.g. "09:30"' }, ...placeProps },
  required: ["time", "name", "neighborhood", "why", "localTip", "source", "candidateId"],
} as const;

export const ITINERARY_TOOL = {
  name: "submit_itinerary",
  description: "Submit the finished itinerary.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short evocative trip title." },
      summary: { type: "string", description: "Two sentences on the feel of the trip and why it fits." },
      days: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: 'e.g. "Day 1"' },
            theme: { type: "string", description: "Neighborhood or theme." },
            stops: {
              type: "array",
              items: STOP_JSON_SCHEMA,
            },
          },
          required: ["label", "theme", "stops"],
        },
      },
      hotels: { type: "array", items: HOTEL_JSON_SCHEMA, description: "Exactly 3 if hotels were requested, otherwise empty." },
      notes: { type: "array", items: { type: "string" }, description: "2–4 short practical notes." },
    },
    required: ["title", "summary", "days", "hotels", "notes"],
  },
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
): string {
  const locked = it.days[day]!.stops.filter((s) => s.locked);
  const per = req.pace === "Slow" ? "3–4" : req.pace === "Packed" ? "5–6" : "4–5";
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

CURRENT ${it.days[day]!.label.toUpperCase()} (${it.days[day]!.theme})
${dayText(it, day)}

TASK
Build a fresh version of this day with ${per} stops, walkable or one short ride apart, with realistic times.
${hint ? `The traveler asked: "${hint}".` : "Make it meaningfully different from the current version."}
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

export const stayLabel = (s: StayPrefs) =>
  `${(s.styles.length ? s.styles.join(" or ") : "any style").toLowerCase()} · ${s.price}/night`;

// ---------------------------------------------------------------------------
// Fast path: outline first, then every day planned in parallel
// ---------------------------------------------------------------------------

export interface OutlineDay {
  label: string;
  theme: string;
  area: string;
  candidateIds: string[];
}
export interface Outline {
  title: string;
  summary: string;
  notes: string[];
  days: OutlineDay[];
}

export const OUTLINE_TOOL = {
  name: "submit_outline",
  description: "Submit the trip outline: title, summary, notes, and one theme and area per day.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short evocative trip title." },
      summary: { type: "string", description: "Two sentences on the feel of the trip and why it fits." },
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
          },
          required: ["label", "theme", "area", "candidateIds"],
        },
      },
    },
    required: ["title", "summary", "notes", "days"],
  },
} as const;

/** Step 1: a quick outline that splits the destination into one area per day and assigns candidates. */
export function buildOutlinePrompt(req: TripRequest, eff: EffectiveSources, lists: CuratorLists, candidates: Candidate[]): string {
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

TASK
Outline a ${req.days}-day trip. Do not plan individual stops yet.
- Give each day a different area (neighborhoods close together, so the day is walkable or one short ride) and a short theme that suits this traveler.
- For each day, list the bracketed ids of 3–6 candidates that belong in that area and fit the traveler. Use each id on one day only. Favor higher-weight sources.
- Notes: 2–3 short practical tips for this traveler in this place (safety, transit, customs, booking).
${req.about.includes("LGBTQ+ traveler") ? "- If the destination warrants it, include a practical LGBTQ+ safety note.\n" : ""}
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
): string {
  const d = outline.days[day]!;
  const per = req.pace === "Slow" ? "3–4" : req.pace === "Packed" ? "5–6" : "4–5";
  const mine = new Set(d.candidateIds);
  const others = new Set(outline.days.flatMap((x, i) => (i === day ? [] : x.candidateIds)));
  const pool = [...candidates.filter((c) => mine.has(c.id)), ...candidates.filter((c) => !mine.has(c.id) && !others.has(c.id))].slice(0, 30);
  const otherDays = outline.days
    .map((x, i) => (i === day ? null : `${x.label}: ${x.theme} (${x.area})`))
    .filter(Boolean)
    .join("; ");
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

${candidateBlock(pool)}

TRIP: "${outline.title}"
Other days (planned separately, don't repeat their areas or places): ${otherDays || "none"}

${context ? `CONTEXT FOR THIS DAY\n${context}\n\n` : ""}TASK
Plan ${d.label}: ${d.theme}, in ${d.area}. ${per} stops in time order, walkable or one short ride apart, with realistic 24h times.
- Build it mainly from the candidates above and set "candidateId" to the bracketed id; the first ones were picked for this day.
- Otherwise use places you are highly confident exist and are open, with candidateId null.
- Tailor every pick to the traveler: respect halal, vegetarian, sober and accessibility needs; suit the age and party. At most one major landmark, with a local angle.
- Mention booking, cash-only or closing days in the tip when relevant. "why" under 18 words, "localTip" under 14 words.
- "stops" must be a JSON array of objects, not a string.
- Give approximate "lat" and "lng" for every stop.
- "source" must be one of: ${activeSources(eff).join(", ")}.

Call submit_day with the theme and stops.`;
}

// ---------------------------------------------------------------------------
// Multi-city: plan the route first, then every day in parallel
// ---------------------------------------------------------------------------

export const ROUTE_TOOL = {
  name: "submit_route",
  description: "Submit the multi-city route: title, summary, notes, and the stops in order with days per stop.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short evocative trip title." },
      summary: { type: "string", description: "Two sentences on the shape of the trip and why it fits." },
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
            transfer: {
              type: ["object", "null"],
              description: "How to get here from the previous stop; null for the first stop.",
              properties: {
                mode: { type: "string", description: "e.g. train, flight, ferry, car, sleeper train" },
                duration: { type: "string", description: "Door-to-door estimate, e.g. \"2h 30m\"" },
                note: { type: "string", description: "One practical tip (under 14 words)." },
              },
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
          required: ["city", "days", "why", "transfer", "dayThemes"],
        },
      },
    },
    required: ["title", "summary", "notes", "legs"],
  },
} as const;

/** Multi-city step 1: choose the stops, their order and days, and a theme for every day. */
export function buildRoutePrompt(req: TripRequest, eff: EffectiveSources, lists: CuratorLists): string {
  const stops = req.days <= 4 ? "2" : req.days <= 7 ? "2–3" : req.days <= 10 ? "3–4" : "4–5";
  return `${travelerBlock(req)}

${sourceBlock(eff, lists)}

TASK
Design a ${req.days}-day multi-stop route through ${req.destination}. Do not plan individual places yet.
- Choose ${stops} stops${req.pace === "Slow" ? " (fewer is better for this slow-paced traveler)" : req.pace === "Packed" ? " (this traveler is happy to move more)" : ""}. Usually at least 2 days per stop; a 1-day stop only for a small place on the way.
- Order them as a sensible line with no backtracking; start and end near a major airport or rail hub when possible.
- Be realistic about transfers: give mode and door-to-door time. A long transfer uses up much of the arrival day.
- Fit the traveler: interests, budget, pace, needs, and the season${req.startDate ? ` (they travel from ${req.startDate})` : ""}. Favor places locals love over tourist circuits, but include the essentials of ${req.destination} when they fit.
- The stops' "days" must add up to exactly ${req.days}. Give one day theme and area per day at each stop.
- Notes: 2–3 practical tips for the whole route.

Call submit_route.`;
}

/** Context line for the first day at a new stop. */
export function arrivalContext(leg: { city: string; transfer?: { mode: string; duration: string; note: string } | null }, from: string): string {
  if (!leg.transfer) return "";
  const t = leg.transfer;
  return `The traveler arrives in ${leg.city} today from ${from} by ${t.mode || "road"}${t.duration ? ` (about ${t.duration})` : ""}. Plan around the arrival: fewer stops, starting after they get in and settle.`;
}
