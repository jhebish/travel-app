/**
 * What a night costs. Hotels are priced in tiers judged against local prices ($ simple, $$
 * comfortable, $$$ upscale, $$$$ top end), because a dollar band means something different in every
 * country: $300 a night is a top hotel in Cairo and an ordinary one in Paris.
 *
 * A destination's price scale (three cut points in US dollars, asked once per destination and
 * cached) turns the tiers into local ranges people can see: "$$ · $40–110" in Egypt. Earlier trips,
 * curators' older picks and the Typeform intake gave dollar bands; those are read through the scale.
 *
 * No zod here: the apps use it in the browser. StayScaleSchema in schemas.ts checks the model's answer.
 */

export const STAY_TIERS = ["$", "$$", "$$$", "$$$$"] as const;
export type StayTier = (typeof STAY_TIERS)[number];

export const STAY_TIER_WORDS: Record<StayTier, string> = { $: "simple", $$: "comfortable", $$$: "upscale", $$$$: "top end" };

/** How the price was asked before tiers: US dollars a night. Still what the Typeform asks. */
export const LEGACY_STAY_PRICES = ["Under $150", "$150–300", "$300–600", "$600+"] as const;
export type LegacyStayPrice = (typeof LEGACY_STAY_PRICES)[number];
export type StayPrice = StayTier | LegacyStayPrice;

/** Every value a stored request may hold. */
export const STAY_PRICE_VALUES = [...STAY_TIERS, ...LEGACY_STAY_PRICES] as const;

export interface StayScale {
  /** US dollars a night (a double, normal season) where $ ends, $$ ends and $$$ ends. */
  cuts: [number, number, number];
}

/** Big Western cities: the prices the old dollar bands were written for. */
export const DEFAULT_STAY_SCALE: StayScale = { cuts: [150, 300, 600] };

/** Where in its band an old dollar answer sits. */
const LEGACY_NIGHTLY: Record<LegacyStayPrice, number> = { "Under $150": 100, "$150–300": 225, "$300–600": 450, "$600+": 800 };

export const isStayTier = (p: unknown): p is StayTier => typeof p === "string" && (STAY_TIERS as readonly string[]).includes(p);

/** The tier a nightly price falls in, in this place. */
export function tierForNightly(usd: number, scale: StayScale = DEFAULT_STAY_SCALE): StayTier {
  const [a, b, c] = scale.cuts;
  return usd < a ? "$" : usd < b ? "$$" : usd < c ? "$$$" : "$$$$";
}

/**
 * A price as a tier: a tier as it is; an old dollar answer by where it falls in this place's prices
 * ("$150–300" is upscale in Cairo, comfortable in Paris); anything else the middle of the range.
 */
export function stayTier(price: string | null | undefined, scale?: StayScale | null): StayTier {
  if (isStayTier(price)) return price;
  const usd = price ? LEGACY_NIGHTLY[price as LegacyStayPrice] : undefined;
  return usd == null ? "$$" : tierForNightly(usd, scale ?? DEFAULT_STAY_SCALE);
}

/** Google's price level for a place to stay is already local: 1 (inexpensive) is $, 4 is $$$$. */
export const tierForPriceLevel = (level: number): StayTier => STAY_TIERS[Math.max(0, Math.min(3, Math.round(level) - 1))]!;

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** What a tier costs here: "under $40", "$40–110", "$250+". */
export function tierRange(tier: StayTier, scale: StayScale): string {
  const [a, b, c] = scale.cuts;
  switch (tier) {
    case "$":
      return `under ${usd(a)}`;
    case "$$":
      return `${usd(a)}–${b.toLocaleString("en-US")}`;
    case "$$$":
      return `${usd(b)}–${c.toLocaleString("en-US")}`;
    default:
      return `${usd(c)}+`;
  }
}

/** A choice's label: with the local range once the place is known, else what the tier means. */
export const tierLabel = (tier: StayTier, scale?: StayScale | null) => `${tier} · ${scale ? tierRange(tier, scale) : STAY_TIER_WORDS[tier]}`;

/** For the hotel prompt: "$$ (comfortable by local standards, about $40–110 a night there)". */
export function tierForPrompt(tier: StayTier, scale?: StayScale | null): string {
  const range = scale ? `, about ${tierRange(tier, scale)} a night there` : "";
  return `${tier} (${STAY_TIER_WORDS[tier]} by local standards${range})`;
}

/** Round a model's price to a figure people use: $35, $110, $250, $1,200. */
export const nicePrice = (n: number) => (n < 100 ? Math.round(n / 5) * 5 : n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 50) * 50);

export const STAY_SCALE_TOOL = {
  name: "submit_hotel_prices",
  description: "Where hotel prices move from one tier to the next in the destination, in US dollars a night.",
  input_schema: {
    type: "object",
    properties: {
      simple_up_to: { type: "integer", description: "The most a simple, clean, well-run place (a good guesthouse or budget hotel) costs a night." },
      comfortable_up_to: { type: "integer", description: "The most a comfortable mid-range hotel costs a night." },
      upscale_up_to: { type: "integer", description: "The most an upscale or boutique hotel costs a night. Above this is the top end." },
    },
    required: ["simple_up_to", "comfortable_up_to", "upscale_up_to"],
  },
} as const;

/** The question for a destination's hotel prices. */
export function buildStayScalePrompt(destination: string): string {
  return [
    `Hotel prices in ${destination}: a standard double room for one night in a normal season, in US dollars including taxes.`,
    "Split the places worth recommending into four tiers: simple (clean and well run, like a good guesthouse), comfortable (a solid mid-range hotel), upscale (boutique or four-star), and top end (the best in town).",
    "Give the price where each of the first three tiers tops out, from what rooms there really cost. Use local prices, not those of a Western capital.",
  ].join("\n");
}
