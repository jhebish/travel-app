/**
 * Everywhere someone has stayed, in one list: the hotel and rental stays their imports found
 * (calendar and email bookings, the hotels their photos were taken at night in) and the ones they
 * added. The same hotel found twice (a calendar stay and its confirmation email) is one entry.
 * The list steers hotel picks: the planner reads the kind of place they choose from it.
 */
import { countryName } from "./countries";
import type { SignalSource } from "./labels";
import { TOP_RANK_SCORE } from "./rank";
import { cityKey } from "./stats";

/** One stay signal, as stored (see TasteSignal). */
export interface StaySignal {
  id: string;
  source: SignalSource;
  name: string;
  city?: string | null;
  countryCode?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  rating?: number | null;
  liked?: boolean | null;
  note?: string | null;
  rankScore?: number | null;
}

export interface PastStay {
  /** Every signal behind this entry: liking or removing it changes them all. */
  ids: string[];
  name: string;
  city: string | null;
  countryCode: string | null;
  /** First and last dates seen (YYYY-MM-DD), when known. */
  first: string | null;
  last: string | null;
  /** Distinct dates it was seen on (stays, at least one). */
  visits: number;
  liked: boolean | null;
  rating: number | null;
  rankScore: number | null;
  sources: SignalSource[];
  /** A stay in a city with no named place ("Airbnb in Lisbon"). */
  generic: boolean;
  note: string | null;
}

/** "Airbnb in Lisbon", "Stay in Porto", "Hotel in Kyoto": the kind of stay, not a place. */
const GENERIC = /^(?:airbnb|vrbo|stay|hotel|hôtel|hostel|ryokan|riad|b&b|guest ?house|booking\.com|expedia|hotels\.com|agoda|hostelworld|marriott bonvoy|hilton honors|world of hyatt|vacation rental|rental) in .+$/i;
export const isGenericStay = (name: string) => GENERIC.test(name.trim());

const nameKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:the|hotel|hôtel|resort|and spa|spa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Most recent first; undated ones last, by name. */
const byRecent = (a: PastStay, b: PastStay) => (b.last ?? "").localeCompare(a.last ?? "") || a.name.localeCompare(b.name);

/**
 * The stay signals as one list: the same place in the same city is one entry, however many
 * imports found it. A like or dislike on any of its signals counts for the entry (a dislike wins).
 */
export function groupStays(signals: StaySignal[]): PastStay[] {
  const out = new Map<string, PastStay & { dates: Set<string> }>();
  for (const s of signals) {
    const name = s.name.trim();
    if (!name) continue;
    const key = `${nameKey(name) || name.toLowerCase()}|${s.city ? cityKey(s.city) : ""}`;
    const had = out.get(key);
    if (!had) {
      out.set(key, {
        ids: [s.id],
        name,
        city: s.city ?? null,
        countryCode: s.countryCode?.toUpperCase() ?? null,
        first: s.date ?? null,
        last: s.date ?? null,
        visits: 0,
        liked: s.liked ?? null,
        rating: s.rating ?? null,
        rankScore: s.rankScore ?? null,
        sources: [s.source],
        generic: isGenericStay(name),
        note: s.note ?? null,
        dates: new Set(s.date ? [s.date] : []),
      });
      continue;
    }
    had.ids.push(s.id);
    if (s.date) {
      had.dates.add(s.date);
      if (!had.first || s.date < had.first) had.first = s.date;
      if (!had.last || s.date > had.last) had.last = s.date;
    }
    if (s.liked === false || had.liked === false) had.liked = false;
    else if (s.liked === true) had.liked = true;
    if (s.rating != null) had.rating = Math.max(had.rating ?? 0, s.rating);
    if (s.rankScore != null) had.rankScore = Math.max(had.rankScore ?? -Infinity, s.rankScore);
    if (!had.sources.includes(s.source)) had.sources.push(s.source);
    if (!had.countryCode && s.countryCode) had.countryCode = s.countryCode.toUpperCase();
    if (!had.note && s.note) had.note = s.note;
    // A named version of the place reads better than a booking site's label for it.
    if (had.generic && !isGenericStay(name)) {
      had.name = name;
      had.generic = false;
    }
  }
  return [...out.values()].map(({ dates, ...s }) => ({ ...s, visits: Math.max(1, dates.size) })).sort(byRecent);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "May 2025", "2023–2025", or "". */
export function stayWhen(s: Pick<PastStay, "first" | "last">): string {
  if (!s.last) return "";
  const y1 = s.first?.slice(0, 4);
  const y2 = s.last.slice(0, 4);
  if (y1 && y1 !== y2) return `${y1}–${y2}`;
  const m = Number(s.last.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y2}` : y2;
}

const loved = (s: PastStay) => s.liked === true || (s.rating ?? 0) >= 4 || (s.rankScore ?? 0) >= TOP_RANK_SCORE;
const disliked = (s: PastStay) => s.liked === false || (s.rating != null && s.rating <= 2);

/**
 * The hotel prompt's block on where they've stayed: what they loved first, then the rest, most
 * recent first, with the ones in this destination called out. Empty without any stays.
 */
export function staysForPrompt(stays: PastStay[], destination: string, max = 25): string {
  if (!stays.length) return "";
  const dest = cityKey(destination);
  const order = [...stays].sort((a, b) => Number(loved(b)) - Number(loved(a)) || Number(disliked(a)) - Number(disliked(b)) || byRecent(a, b));
  const shown = order.slice(0, max);
  const line = (s: PastStay) => {
    const where = [s.city, s.countryCode ? countryName(s.countryCode) : null].filter(Boolean).join(", ");
    const when = stayWhen(s);
    const tags = [s.visits > 1 ? `${s.visits} stays` : "", loved(s) ? "loved it" : "", disliked(s) ? "didn't like it" : ""].filter(Boolean);
    return `- ${s.name}${where ? ` (${where}${when ? `, ${when}` : ""})` : when ? ` (${when})` : ""}${tags.length ? ` · ${tags.join(" · ")}` : ""}`;
  };
  const here = shown.filter((s) => s.city && cityKey(s.city) === dest);
  const rentals = stays.filter((s) => /^(?:airbnb|vrbo|vacation rental|rental)\b/i.test(s.name)).length;
  return `WHERE THEY'VE STAYED (${stays.length} ${stays.length === 1 ? "stay" : "stays"}, from their calendar, email and photos and what they added)
Read the kind of place they choose from these: independent or chain, boutique or big resort, hotels or rentals, how upscale. Pick hotels like the ones they chose again or loved, in the price tier asked for. Never suggest one they didn't like.${
    rentals * 2 >= stays.length ? " They often rent whole places; favour apartment-style hotels and guesthouses with space." : ""
  }${here.length ? ` They've stayed in ${here[0]!.city} before: a place there they loved can be one of the options, saying so in "why".` : ""}
${shown.map(line).join("\n")}`;
}
