/**
 * The Odyssey in the interface: small, plain helpers the site and the app share.
 *
 * - Days are numbered in Roman numerals (Day I, Day II…), like the books of a poem.
 * - A day's stops fall into Dawn, Midday and Dusk, after Homer's "rosy-fingered Dawn".
 * - Every city someone has been to strikes its own coin, as each Greek city did.
 *
 * No zod here, so pages can use these in the browser without the schemas.
 */
import { cityKey } from "./stats";

// ---------------------------------------------------------------------------
// Day numerals
// ---------------------------------------------------------------------------
const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

/** 1 → "I", 4 → "IV", 14 → "XIV". Numbers outside 1–3999 come back as plain digits. */
export function romanNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let out = "";
  let left = n;
  for (const [value, glyph] of ROMAN) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}

/**
 * How a day's label is shown: "Day 3" → "Day III". Trips store "Day 3" (the planner, the route
 * editor and old trips all do), so this is applied where a label is drawn, never where it is saved.
 * Any other label ("Arrival", "Lisbon") is left as it is.
 */
export function dayTitle(label: string): string {
  const m = /^\s*day\s+(\d{1,3})\s*$/i.exec(label);
  return m ? `Day ${romanNumeral(Number(m[1]))}` : label;
}

// ---------------------------------------------------------------------------
// Dawn, Midday, Dusk
// ---------------------------------------------------------------------------
export type DayPart = "dawn" | "midday" | "dusk";

export const DAY_PART_LABELS: Record<DayPart, string> = { dawn: "Dawn", midday: "Midday", dusk: "Dusk" };

/**
 * The part of the day a stop's time falls in: before noon is Dawn, noon to five is Midday, five
 * onward is Dusk. The small hours (before 5am) count as Dusk: a 1am bar ends the night, it doesn't
 * start the morning. Times are 24h "09:30"; anything else has no part.
 */
export function dayPart(time: string): DayPart | null {
  const m = /^\s*(\d{1,2})[:.h](\d{2})\s*$/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour > 23 || Number(m[2]) > 59) return null;
  if (hour < 5) return "dusk";
  if (hour < 12) return "dawn";
  if (hour < 17) return "midday";
  return "dusk";
}

/**
 * For each stop in a day, the part it opens (so the page can head it "Dawn"), or null when it
 * carries on the part before it. A stop with no readable time stays in the part before it.
 */
export function dayPartHeads(times: string[]): { part: DayPart | null; head: DayPart | null }[] {
  let current: DayPart | null = null;
  return times.map((t) => {
    const part = dayPart(t) ?? current;
    const head = part && part !== current ? part : null;
    current = part;
    return { part, head };
  });
}

// ---------------------------------------------------------------------------
// City coins
// ---------------------------------------------------------------------------
/** What a coin carries on its face. Each city gets one, always the same one. */
export const COIN_EMBLEMS = ["sun", "star", "olive", "amphora", "ship", "anchor", "trident", "wave", "lyre", "crescent"] as const;
export type CoinEmblem = (typeof COIN_EMBLEMS)[number];

/** Bronze for a first visit, silver for a second, gold from the third. */
export type CoinMetal = "bronze" | "silver" | "gold";

export interface CityCoin {
  /** Country and city, folded: "pt:lisbon". */
  key: string;
  city: string;
  countryCode: string;
  /** The letters struck on the coin, as Greek cities abbreviated their names: "LIS", "NY". */
  legend: string;
  emblem: CoinEmblem;
  metal: CoinMetal;
  visits: number;
  firstYear: number | null;
  lastYear: number | null;
  /** The most recent visit's id, for linking to its page. */
  latestId: string;
  /** A few degrees of turn, so a row of coins looks hand-struck. Between -8 and 8. */
  turn: number;
}

/** A small stable hash (FNV-1a with a final mix), so a city's emblem and turn never change. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The letters on a coin: the first three of a one-word name ("Lisbon" → "LIS"), or the initials of
 * a longer one ("New York" → "NY", "Rio de Janeiro" → "RDJ").
 */
export function coinLegend(city: string): string {
  const name = city.split(",")[0]!.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const words = name.split(/[\s\-–'’.]+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return "";
  const letters = (w: string) => [...w].filter((ch) => /\p{L}/u.test(ch));
  const legend = words.length === 1 ? letters(words[0]!).slice(0, 3).join("") : words.slice(0, 3).map((w) => letters(w)[0] ?? "").join("");
  return legend.toUpperCase();
}

/**
 * One coin per city from someone's logged places, most recently visited first (undated last).
 * The same city logged twice is one coin with two visits.
 */
export function cityCoins(places: { id: string; city: string; countryCode: string; year: number | null; month?: number | null }[]): CityCoin[] {
  const byKey = new Map<string, { coin: CityCoin; when: number }>();
  for (const p of places) {
    const key = `${p.countryCode.toLowerCase()}:${cityKey(p.city)}`;
    const when = p.year ? p.year * 12 + (p.month ?? 0) : 0;
    const seen = byKey.get(key);
    if (!seen) {
      const h = hash(key);
      byKey.set(key, {
        when,
        coin: {
          key,
          city: p.city.split(",")[0]!.trim(),
          countryCode: p.countryCode.toUpperCase(),
          legend: coinLegend(p.city),
          emblem: COIN_EMBLEMS[h % COIN_EMBLEMS.length]!,
          metal: "bronze",
          visits: 1,
          firstYear: p.year,
          lastYear: p.year,
          latestId: p.id,
          turn: ((h >>> 12) % 17) - 8,
        },
      });
      continue;
    }
    const c = seen.coin;
    c.visits += 1;
    if (p.year != null) {
      c.firstYear = c.firstYear == null ? p.year : Math.min(c.firstYear, p.year);
      c.lastYear = c.lastYear == null ? p.year : Math.max(c.lastYear, p.year);
    }
    if (when > seen.when) {
      seen.when = when;
      c.latestId = p.id;
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.when - a.when || a.coin.city.localeCompare(b.coin.city))
    .map(({ coin }) => ({ ...coin, metal: coin.visits >= 3 ? "gold" : coin.visits === 2 ? "silver" : "bronze" }));
}
