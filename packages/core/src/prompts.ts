import type { Candidate } from "./ranking";
import type { Itinerary, StayPrefs, TripRequest } from "./schemas";
import { SOURCE_BY_ID, SOURCES } from "./sources";
import { activeSources, type EffectiveSources } from "./weights";

export const SYSTEM_PROMPT = `You are the itinerary engine for a travel app whose whole point is experiencing a place the way locals do.
You build bespoke, realistic plans from a list of vetted candidate places, guided by source priorities the app gives you.
You never invent places. You always respond by calling the provided tool.`;

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
  if (!cands.length) return "CANDIDATES\n(none found — use only places you are highly confident exist)";
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

export function stayRules(stay: StayPrefs): string {
  return `HOTELS
- Exactly 3 places to stay. Style: ${stay.styles.length ? stay.styles.join(" or ") : "any"}. Typical nightly rate for a standard double: ${stay.price}.
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
  return `${travelerBlock(req)}

The trip already planned spends time in: ${areas.join(", ") || req.destination}.

${sourceBlock(eff, lists)}

${candidateBlock(candidates)}

${stayRules(req.stay)}
- Set "candidateId" to the bracketed id you used, or null for a place you are highly confident exists.
- Every "source" must be one of: ${activeSources(eff).join(", ")}.

Call submit_hotels with your three picks.`;
}

// ---------------------------------------------------------------------------
// Tool schemas (JSON Schema) for structured output
// ---------------------------------------------------------------------------

const sourceEnum = SOURCES.map((s) => s.id);

const placeProps = {
  name: { type: "string" },
  neighborhood: { type: "string" },
  why: { type: "string", description: "One sentence on why it fits this traveler." },
  localTip: { type: "string", description: "One practical insider tip." },
  source: { type: "string", enum: sourceEnum },
  candidateId: { type: ["string", "null"], description: "Bracketed candidate id, or null." },
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
              items: {
                type: "object",
                properties: { time: { type: "string", description: '24h, e.g. "09:30"' }, ...placeProps },
                required: ["time", "name", "neighborhood", "why", "localTip", "source", "candidateId"],
              },
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
  description: "Submit three places to stay.",
  input_schema: {
    type: "object",
    properties: { hotels: { type: "array", items: HOTEL_JSON_SCHEMA } },
    required: ["hotels"],
  },
} as const;

export const stayLabel = (s: StayPrefs) =>
  `${(s.styles.length ? s.styles.join(" or ") : "any style").toLowerCase()} · ${s.price}/night`;
