export const SOURCE_IDS = [
  "locals",
  "hosts",
  "friends",
  "press",
  "indie",
  "reviews",
  "guidebooks",
  "social",
  "sponsored",
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

export interface SourceDef {
  id: SourceId;
  name: string;
  description: string;
  defaultWeight: number;
  defaultBlocked?: boolean;
}

export const SOURCES: readonly SourceDef[] = [
  { id: "locals", name: "Local residents", description: "Picks from people who live in the neighborhood: their regular café, their Friday spot.", defaultWeight: 10 },
  { id: "hosts", name: "Vetted local hosts & guides", description: "Your network of hosts and guides on the ground.", defaultWeight: 9 },
  { id: "friends", name: "Friends who've been", description: "Places your friends loved there, and their answers when you ask them.", defaultWeight: 9 },
  { id: "press", name: "Local press & food writers", description: "City magazines, local critics, neighborhood newsletters.", defaultWeight: 7 },
  { id: "indie", name: "Independent blogs", description: "Long-form travel writers and niche bloggers.", defaultWeight: 5 },
  { id: "reviews", name: "Review platforms", description: "Google Maps, Yelp, TripAdvisor ratings.", defaultWeight: 3 },
  { id: "guidebooks", name: "Major guidebooks", description: "Lonely Planet, Fodor's, Michelin and similar.", defaultWeight: 3 },
  { id: "social", name: "Social & influencers", description: "TikTok, Instagram and creator lists.", defaultWeight: 1 },
  { id: "sponsored", name: "Sponsored listings", description: "Paid placements and affiliate-driven lists.", defaultWeight: 0, defaultBlocked: true },
];

export const SOURCE_BY_ID: Record<SourceId, SourceDef> = Object.fromEntries(
  SOURCES.map((s) => [s.id, s]),
) as Record<SourceId, SourceDef>;

export const isSourceId = (v: unknown): v is SourceId =>
  typeof v === "string" && (SOURCE_IDS as readonly string[]).includes(v);

export type Weights = Record<SourceId, number>;

export const defaultWeights = (): Weights =>
  Object.fromEntries(SOURCES.map((s) => [s.id, s.defaultWeight])) as Weights;

export const defaultBlocked = (): SourceId[] =>
  SOURCES.filter((s) => s.defaultBlocked).map((s) => s.id);

export const STAY_STYLES = ["Boutique", "Design-led", "Guesthouse or B&B", "Luxury", "Apartment-style"] as const;
export const STAY_PRICES = ["Under $150", "$150–300", "$300–600", "$600+"] as const;
export type StayPrice = (typeof STAY_PRICES)[number];

/** Nightly USD bounds for a price band, used to filter live rates. */
export const STAY_PRICE_RANGE: Record<StayPrice, [number, number]> = {
  "Under $150": [0, 150],
  "$150–300": [150, 300],
  "$300–600": [300, 600],
  "$600+": [600, Number.POSITIVE_INFINITY],
};
