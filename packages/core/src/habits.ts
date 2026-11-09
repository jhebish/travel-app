/**
 * How someone travels, counted from their past trips (a city in a year, with its month and length
 * when known): how often, for how long, in which months, where they keep going back. Plain
 * functions with no zod, for the server (the taste prompt) and the phone (what a scan learned).
 */
import { countryName } from "./countries";
import { pastTripIsOver } from "./privacy";
import { cityKey } from "./stats";

export interface HabitTrip {
  city: string;
  countryCode: string;
  year: number | null;
  /** 1–12 */
  month: number | null;
  days: number | null;
}

export interface TravelHabits {
  /** Trips that are over (each a city in a year). */
  trips: number;
  /** The first year with a trip. */
  since: number | null;
  /** Trips a year since then, with at least a year and a half of them; otherwise null. */
  perYear: number | null;
  /** The middle length of the trips that have one, when at least three do. */
  typicalDays: number | null;
  longest: { city: string; days: number; year: number | null } | null;
  /**
   * The months most trips fall in: three in a row (four when two such stretches side by side tie),
   * when they hold at least 40% of the trips with a month.
   */
  peakMonths: number[] | null;
  countries: number;
  /** The country they've gone back to most (in distinct years), when it's at least three and more than any other. */
  topCountry: { code: string; years: number } | null;
  /** Cities they've been to in two or more different years, most first (at most three). */
  returns: { city: string; countryCode: string; years: number }[];
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const YEAR_MS = 365.25 * 864e5;

/** Distinct visits: each year with a trip there, plus each trip with no year. */
function visits(trips: HabitTrip[]): number {
  return new Set(trips.map((t, i) => (t.year == null ? `?${i}` : String(t.year)))).size;
}

export function travelHabits(all: HabitTrip[], now: Date | number = Date.now()): TravelHabits {
  const trips = all.filter((t) => pastTripIsOver(t, now));
  const years = trips.map((t) => t.year).filter((y): y is number => y != null);
  const since = years.length ? Math.min(...years) : null;
  const span = since == null ? 0 : (new Date(now).getTime() - Date.UTC(since, 0, 1)) / YEAR_MS;
  const perYear = since != null && span >= 1.5 && years.length >= 3 ? years.length / span : null;

  const lengths = trips.filter((t) => (t.days ?? 0) > 0);
  const sorted = lengths.map((t) => t.days!).sort((a, b) => a - b);
  const typicalDays = sorted.length >= 3 ? sorted[Math.floor((sorted.length - 1) / 2)]! : null;
  const top = [...lengths].sort((a, b) => b.days! - a.days! || (b.year ?? 0) - (a.year ?? 0))[0];
  const longest = top && top.days! >= 2 && lengths.length >= 2 ? { city: top.city, days: top.days!, year: top.year } : null;

  // Months: the three in a row (wrapping past December) with the most trips, trimmed of empty ends.
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const t of trips) if (t.month && t.month >= 1 && t.month <= 12) byMonth[t.month - 1]!++;
  const dated = byMonth.reduce((a, b) => a + b, 0);
  let peakMonths: number[] | null = null;
  if (dated >= 4) {
    const inWindow = Array.from({ length: 12 }, (_, m) => byMonth[m]! + byMonth[(m + 1) % 12]! + byMonth[(m + 2) % 12]!);
    const bestN = Math.max(...inWindow);
    // Two windows side by side doing equally well: say the four months they cover.
    const pair = inWindow.findIndex((n, m) => n === bestN && inWindow[(m + 1) % 12] === bestN);
    let best = pair;
    if (best < 0) {
      // Otherwise, of equal windows, the one whose middle month is busiest.
      best = inWindow.indexOf(bestN);
      for (let m = best + 1; m < 12; m++) if (inWindow[m] === bestN && byMonth[(m + 1) % 12]! > byMonth[(best + 1) % 12]!) best = m;
    }
    if (bestN >= 3 && bestN >= dated * 0.4) {
      const win = Array.from({ length: pair >= 0 ? 4 : 3 }, (_, i) => (best + i) % 12);
      while (win.length && byMonth[win[0]!] === 0) win.shift();
      while (win.length && byMonth[win[win.length - 1]!] === 0) win.pop();
      peakMonths = win.map((m) => m + 1);
    }
  }

  const byCountry = new Map<string, HabitTrip[]>();
  for (const t of trips) {
    const c = t.countryCode.toUpperCase();
    byCountry.set(c, [...(byCountry.get(c) ?? []), t]);
  }
  const countryVisits = [...byCountry].map(([code, ts]) => ({ code, years: visits(ts) })).sort((a, b) => b.years - a.years);
  const topCountry = countryVisits[0] && countryVisits[0].years >= 3 && countryVisits[0].years > (countryVisits[1]?.years ?? 0) ? countryVisits[0] : null;

  const byCity = new Map<string, { city: string; countryCode: string; years: Set<number>; last: number }>();
  for (const t of trips) {
    if (t.year == null) continue;
    const k = `${t.countryCode.toUpperCase()}:${cityKey(t.city)}`;
    const c = byCity.get(k) ?? { city: t.city, countryCode: t.countryCode.toUpperCase(), years: new Set<number>(), last: 0 };
    c.years.add(t.year);
    c.last = Math.max(c.last, t.year);
    byCity.set(k, c);
  }
  const returns = [...byCity.values()]
    .filter((c) => c.years.size >= 2)
    .sort((a, b) => b.years.size - a.years.size || b.last - a.last)
    .slice(0, 3)
    .map((c) => ({ city: c.city, countryCode: c.countryCode, years: c.years.size }));

  return { trips: trips.length, since, perYear, typicalDays, longest, peakMonths, countries: byCountry.size, topCountry, returns };
}

/** "in August", "in July and August", "between December and February". */
export function monthsText(months: number[]): string {
  const names = months.map((m) => MONTH_NAMES[m - 1]!);
  if (names.length <= 1) return names[0] ? `in ${names[0]}` : "";
  if (names.length === 2) return `in ${names[0]} and ${names[1]}`;
  return `between ${names[0]} and ${names[names.length - 1]}`;
}

const rateText = (perYear: number) =>
  perYear >= 1.5 ? `about ${Math.round(perYear)} a year` : perYear >= 0.75 ? "about one a year" : `about one every ${Math.round(1 / perYear)} years`;
const daysWord = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * The habits as short sentences, addressed to the traveler, for what a scan learned and for the
 * taste prompt. Nothing for fewer than two trips: one trip isn't a habit.
 */
export function habitLines(h: TravelHabits): string[] {
  if (h.trips < 2) return [];
  const lines: string[] = [];
  const count = `${h.trips} trips${h.since ? ` since ${h.since}` : ""}`;
  lines.push(h.perYear != null ? `${count}, ${rateText(h.perYear)}.` : `${count}.`);

  if (h.typicalDays != null) {
    const longest = h.longest && h.longest.days > h.typicalDays ? `; the longest was ${daysWord(h.longest.days)} in ${h.longest.city}${h.longest.year ? ` (${h.longest.year})` : ""}` : "";
    lines.push(`Usually about ${daysWord(h.typicalDays)} away${longest}.`);
  } else if (h.longest) {
    lines.push(`Your longest trip was ${daysWord(h.longest.days)} in ${h.longest.city}${h.longest.year ? ` (${h.longest.year})` : ""}.`);
  }

  if (h.peakMonths?.length) lines.push(`Most of your trips are ${monthsText(h.peakMonths)}.`);

  // The country only when it isn't just the city they keep going back to (said next).
  const top = h.topCountry && !h.returns.some((r) => r.countryCode === h.topCountry!.code && r.years >= h.topCountry!.years) ? h.topCountry : null;
  if (h.countries >= 2) {
    lines.push(top ? `${h.countries} countries so far; you've been to ${countryName(top.code)} in ${top.years} different years, more than anywhere else.` : `${h.countries} countries so far.`);
  }

  if (h.returns.length) {
    const [first, ...rest] = h.returns;
    lines.push(`You keep going back to ${andList([`${first!.city} (${first!.years} different years)`, ...rest.map((r) => `${r.city} (${r.years})`)])}.`);
  }
  return lines;
}
