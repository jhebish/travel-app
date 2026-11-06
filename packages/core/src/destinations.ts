/**
 * Destinations featured on the Browse globe.
 *
 * A mix of places named on 2026 trend lists (noted in `trend`) and Pylos picks. Cities get a
 * single-place sample itinerary; countries and regions get a multi-stop one.
 * Coordinates mark where the pin sits on the globe.
 */
export type DestinationKind = "city" | "region";

export const DESTINATION_TAGS = ["Food", "Culture", "History", "Beaches", "Nature", "Nightlife", "Art & design", "Markets"] as const;
export type DestinationTag = (typeof DESTINATION_TAGS)[number];

export interface Destination {
  key: string;
  name: string;
  country: string;
  countryCode: string;
  kind: DestinationKind;
  lat: number;
  lng: number;
  blurb: string;
  tags: DestinationTag[];
  /** Months (1–12) that are usually the best time to go. */
  bestMonths: number[];
  /** Where the "trending" signal comes from, shown as a small label. */
  trend?: "Lonely Planet Best in Travel 2026" | "Booking.com trending for 2026";
  /** Days for the sample itinerary. */
  sampleDays: number;
}

const LP = "Lonely Planet Best in Travel 2026" as const;
const BK = "Booking.com trending for 2026" as const;

export const DESTINATIONS: Destination[] = [
  { key: "mexico-city", name: "Mexico City", country: "Mexico", countryCode: "MX", kind: "city", lat: 19.4326, lng: -99.1332, blurb: "Taquerías, mercados and murals across walkable colonias: one of the world's great food cities.", tags: ["Food", "Art & design", "Culture", "Nightlife"], bestMonths: [3, 4, 10, 11, 12], trend: LP, sampleDays: 3 },
  { key: "cadiz", name: "Cádiz", country: "Spain", countryCode: "ES", kind: "city", lat: 36.5271, lng: -6.2886, blurb: "An ancient Atlantic port of sherry bars, fried-fish tapas and long city beaches.", tags: ["Beaches", "Food", "History"], bestMonths: [4, 5, 6, 9, 10], trend: LP, sampleDays: 3 },
  { key: "utrecht", name: "Utrecht", country: "Netherlands", countryCode: "NL", kind: "city", lat: 52.0907, lng: 5.1214, blurb: "Canal wharves with cafés at water level, a cathedral tower and bikes everywhere.", tags: ["Culture", "Food", "Art & design"], bestMonths: [4, 5, 6, 9], trend: LP, sampleDays: 2 },
  { key: "cartagena", name: "Cartagena", country: "Colombia", countryCode: "CO", kind: "city", lat: 10.391, lng: -75.4794, blurb: "A walled colonial city of balconies and bougainvillea, Caribbean seafood and salsa in Getsemaní.", tags: ["History", "Beaches", "Nightlife", "Food"], bestMonths: [12, 1, 2, 3], trend: LP, sampleDays: 3 },
  { key: "siem-reap", name: "Siem Reap", country: "Cambodia", countryCode: "KH", kind: "city", lat: 13.3671, lng: 103.8448, blurb: "The gateway to Angkor's temples, with a creative food and arts scene in town.", tags: ["History", "Culture", "Food"], bestMonths: [11, 12, 1, 2], trend: LP, sampleDays: 3 },
  { key: "sao-paulo", name: "São Paulo", country: "Brazil", countryCode: "BR", kind: "city", lat: -23.5505, lng: -46.6333, blurb: "Brazil's food capital, from Liberdade's Japanese-Brazilian streets to late-night botecos.", tags: ["Food", "Art & design", "Nightlife"], bestMonths: [4, 5, 9, 10], trend: LP, sampleDays: 3 },
  { key: "quy-nhon", name: "Quy Nhơn", country: "Vietnam", countryCode: "VN", kind: "city", lat: 13.783, lng: 109.2197, blurb: "Quiet beaches, Cham towers and just-caught seafood on Vietnam's south-central coast.", tags: ["Beaches", "Food", "Nature"], bestMonths: [3, 4, 5, 6, 7, 8], trend: LP, sampleDays: 3 },
  { key: "bilbao", name: "Bilbao", country: "Spain", countryCode: "ES", kind: "city", lat: 43.263, lng: -2.935, blurb: "Pintxos bars in the old town, the Guggenheim on the river and Basque cooking everywhere.", tags: ["Food", "Art & design", "Culture"], bestMonths: [5, 6, 7, 8, 9], trend: BK, sampleDays: 3 },
  { key: "philadelphia", name: "Philadelphia", country: "United States", countryCode: "US", kind: "city", lat: 39.9526, lng: -75.1652, blurb: "The US turns 250 in 2026 and Philly is where it began, with markets and murals to match.", tags: ["History", "Food", "Art & design"], bestMonths: [4, 5, 6, 9, 10], trend: BK, sampleDays: 3 },
  { key: "kochi", name: "Kochi", country: "India", countryCode: "IN", kind: "city", lat: 9.9312, lng: 76.2673, blurb: "Kerala's spice-trade port: fishing nets, old Fort Kochi and fragrant seafood curries.", tags: ["Food", "History", "Culture"], bestMonths: [11, 12, 1, 2, 3], trend: BK, sampleDays: 3 },
  { key: "lisbon", name: "Lisbon", country: "Portugal", countryCode: "PT", kind: "city", lat: 38.7223, lng: -9.1393, blurb: "Tiled hills, tascas and fado, with river light that makes every viewpoint worth the climb.", tags: ["Food", "History", "Nightlife"], bestMonths: [3, 4, 5, 6, 9, 10], sampleDays: 3 },
  { key: "kyoto", name: "Kyoto", country: "Japan", countryCode: "JP", kind: "city", lat: 35.0116, lng: 135.7681, blurb: "Temples, tea houses and tiny counter restaurants; spring blossom and autumn leaves are peak.", tags: ["Culture", "Food", "Nature"], bestMonths: [3, 4, 10, 11], sampleDays: 3 },
  { key: "marrakech", name: "Marrakech", country: "Morocco", countryCode: "MA", kind: "city", lat: 31.6295, lng: -7.9811, blurb: "Souks, riad courtyards and rooftop mint tea, with the Atlas Mountains a day trip away.", tags: ["Markets", "Art & design", "Food"], bestMonths: [3, 4, 5, 10, 11], sampleDays: 3 },
  { key: "istanbul", name: "Istanbul", country: "Türkiye", countryCode: "TR", kind: "city", lat: 41.0082, lng: 28.9784, blurb: "Two continents, ferries across the Bosphorus and meyhanes where dinner lasts all night.", tags: ["Food", "History", "Markets"], bestMonths: [4, 5, 9, 10, 11], sampleDays: 3 },
  { key: "oaxaca", name: "Oaxaca", country: "Mexico", countryCode: "MX", kind: "city", lat: 17.0732, lng: -96.7266, blurb: "Mexico's culinary heart: moles, mezcal and markets, with weaving villages in the valleys.", tags: ["Food", "Markets", "Culture"], bestMonths: [10, 11, 12, 1, 2, 3], sampleDays: 3 },
  { key: "cape-town", name: "Cape Town", country: "South Africa", countryCode: "ZA", kind: "city", lat: -33.9249, lng: 18.4241, blurb: "Table Mountain hikes, wine-country day trips and long summer evenings by the Atlantic.", tags: ["Nature", "Food", "Beaches"], bestMonths: [11, 12, 1, 2, 3], sampleDays: 3 },
  { key: "athens", name: "Athens", country: "Greece", countryCode: "GR", kind: "city", lat: 37.9838, lng: 23.7275, blurb: "Ancient sites by day, rooftop bars facing the Acropolis by night, and neighbourhood tavernas.", tags: ["History", "Food", "Nightlife"], bestMonths: [4, 5, 6, 9, 10], sampleDays: 3 },
  { key: "egypt", name: "Egypt", country: "Egypt", countryCode: "EG", kind: "region", lat: 25.6872, lng: 32.6396, blurb: "Cairo's bazaars and pyramids, then south to Luxor's temples and Aswan's feluccas on the Nile.", tags: ["History", "Culture", "Markets"], bestMonths: [10, 11, 12, 1, 2, 3], sampleDays: 7 },
  { key: "sardinia", name: "Sardinia", country: "Italy", countryCode: "IT", kind: "region", lat: 40.1209, lng: 9.0129, blurb: "Turquoise coves, mountain villages and a food culture all its own.", tags: ["Beaches", "Food", "Nature"], bestMonths: [5, 6, 9, 10], trend: LP, sampleDays: 6 },
  { key: "tunisia", name: "Tunisia", country: "Tunisia", countryCode: "TN", kind: "region", lat: 35.5, lng: 9.6, blurb: "Medinas, Roman ruins and Saharan oases, with blue-and-white villages on the Mediterranean.", tags: ["History", "Markets", "Beaches"], bestMonths: [3, 4, 5, 10, 11], trend: LP, sampleDays: 7 },
  { key: "peru", name: "Peru", country: "Peru", countryCode: "PE", kind: "region", lat: -13.532, lng: -71.9675, blurb: "Lima's celebrated restaurants, Cusco's Inca streets and the Sacred Valley toward Machu Picchu.", tags: ["Food", "History", "Nature"], bestMonths: [5, 6, 7, 8, 9], trend: LP, sampleDays: 7 },
  { key: "cyclades", name: "The Cyclades", country: "Greece", countryCode: "GR", kind: "region", lat: 37.05, lng: 25.2, blurb: "Island-hop whitewashed villages, quiet coves and seafood tavernas across the Aegean.", tags: ["Beaches", "Food", "Nature"], bestMonths: [5, 6, 9, 10], sampleDays: 6 },
  { key: "jeju", name: "Jeju-do", country: "South Korea", countryCode: "KR", kind: "region", lat: 33.38, lng: 126.55, blurb: "Korea's volcanic island: coastal trails, haenyeo divers' seafood and tangerine groves.", tags: ["Nature", "Food", "Beaches"], bestMonths: [4, 5, 9, 10], trend: LP, sampleDays: 4 },
  { key: "botswana", name: "Botswana", country: "Botswana", countryCode: "BW", kind: "region", lat: -19.98, lng: 23.42, blurb: "Safari in the Okavango Delta and Chobe, some of Africa's richest wildlife country.", tags: ["Nature"], bestMonths: [5, 6, 7, 8, 9, 10], trend: LP, sampleDays: 6 },
];

export const DESTINATION_BY_KEY: Record<string, Destination> = Object.fromEntries(DESTINATIONS.map((d) => [d.key, d]));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar–May, Oct" style summary of best months. */
export function monthsLabel(months: number[]): string {
  const m = [...new Set(months)].filter((x) => x >= 1 && x <= 12).sort((a, b) => a - b);
  if (!m.length) return "";
  const runs: [number, number][] = [];
  for (const x of m) {
    const last = runs[runs.length - 1];
    if (last && x === last[1] + 1) last[1] = x;
    else runs.push([x, x]);
  }
  // Join a Dec run with a Jan run (Nov–Feb).
  if (runs.length > 1 && runs[0]![0] === 1 && runs[runs.length - 1]![1] === 12) {
    const first = runs.shift()!;
    runs[runs.length - 1]![1] = first[1];
  }
  return runs.map(([a, b]) => (a === b ? MONTHS[a - 1] : `${MONTHS[a - 1]}–${MONTHS[b - 1]}`)).join(", ");
}

/** Is `month` (1–12) one of the destination's best months? */
export const inSeason = (d: Destination, month: number) => d.bestMonths.includes(month);

/**
 * Trend score for ordering the globe: in season now, named on a trend list, and activity on Pylos
 * (trips built in the last 30 days, likes on public trips).
 */
export function trendScore(d: Destination, month: number, activity: { recent: number; likes: number } = { recent: 0, likes: 0 }) {
  return (inSeason(d, month) ? 3 : 0) + (d.trend ? 2 : 0) + Math.min(6, activity.recent * 0.5) + Math.min(4, activity.likes * 0.25);
}

/** The trip request used for a destination's sample itinerary. */
export function sampleRequest(d: Destination) {
  return {
    mode: d.kind === "region" ? ("multi" as const) : ("single" as const),
    destination: d.kind === "region" ? d.name : `${d.name}, ${d.country}`,
    days: d.sampleDays,
    startDate: null,
    party: "Couple" as const,
    age: null,
    about: [],
    budget: "Mid-range" as const,
    interests: d.tags.filter((t) => ["Food", "History", "Nature", "Nightlife", "Art & design"].includes(t)).map((t) => (t === "Nature" ? "Nature & outdoors" : t)),
    pace: "Balanced" as const,
    extra: "",
    stay: { on: false, styles: [], price: "$150–300" as const },
  };
}

export interface BrowseDestination extends Destination {
  score: number;
  /** Public trips on Pylos for this place. */
  publicTrips: number;
  inSeason: boolean;
}

export interface ForYouPick {
  key: string;
  why: string;
}
