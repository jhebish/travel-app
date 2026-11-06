import { countryName, isCountryCode } from "../countries";
import type { SignalKind, TasteSignal } from "../taste";
import { airportByCode, airportByName, canonicalCity, knownCity, usStateName } from "./cities";
import { collapse, refKey } from "./dedupe";
import { matchKind } from "./kind";
import { MAX_IMPORT_SIGNALS, countryCodeFromName, isStreetLine, makeSignal, parseAddress, type AddressParts } from "./place";
import { dateFromText, fold, hashString, nameKey, validDay } from "./text";

/**
 * A calendar event: from the Google Calendar API (mapped on the server) or from a calendar on the
 * person's phone (read on the device; summary = title, description = notes). `start` and `end`
 * are "YYYY-MM-DD" for all-day events, else ISO date-times: local with an offset, as Google gives
 * them ("2025-05-14T20:00:00-04:00"), or UTC, as phones give them ("2025-05-15T00:00:00.000Z").
 */
export interface CalendarEventLike {
  id?: string;
  summary?: string;
  location?: string;
  /** Only read to spot a booking site ("Resy", "Booking.com"); never kept. */
  description?: string;
  start?: string;
  end?: string;
  /**
   * The IANA zone the event took place in (the event's own, else the phone's), so a UTC time is
   * dated right: dinner at 8pm in New York is midnight UTC. Without it, UTC is read in this
   * device's zone.
   */
  timeZone?: string;
  /** An occurrence of a repeating event (Google's recurringEventId, a phone event's recurrenceRule). */
  recurring?: boolean;
}

interface Hit {
  kind: SignalKind;
  name: string;
  city: string | null;
  countryCode: string | null;
  note: string | null;
  /** On flights: the city it left from, when known. */
  flight?: { origin: string | null };
}

/**
 * Turn calendar events into signals, keeping only travel:
 *  - flights → "city" at the destination (not flights home, once it's clear where home is);
 *  - hotel and rental stays → "stay";
 *  - restaurant reservations and meals out (Resy, OpenTable, Tock, SevenRooms…) → "food",
 *    or "drink" / "coffee" for drinks and coffee;
 *  - tours, tickets, classes and tastings → "activity";
 *  - trips ("Trip to Lisbon", a multi-day "Lisbon 🇵🇹") → "city".
 * Everything else is left out: meetings, birthdays, holidays, chores, and any repeating event.
 * Precision over recall: when in doubt an event is left out.
 */
export function calendarSignals(events: CalendarEventLike[], source: "google_calendar" | "ics"): TasteSignal[] {
  const list = (Array.isArray(events) ? events : []).filter((ev): ev is CalendarEventLike => !!ev && typeof ev === "object");
  const series = repeatingIds(list);
  const found: { hit: Hit; ref: string; date: string | null; start: string }[] = [];
  for (const ev of list) {
    const id = typeof ev.id === "string" ? ev.id.trim() : "";
    if (ev.recurring === true || (id && (series.has(id) || GOOGLE_OCCURRENCE.test(id)))) continue;
    const start = asIso(ev.start);
    const hits = classify(ev, start);
    if (!hits.length) continue;
    const base = id ? `cal:${id}` : `cal:${hashString(`${typeof ev.summary === "string" ? ev.summary : ""}|${start}`)}`;
    const date = eventDay(start, typeof ev.timeZone === "string" ? ev.timeZone : undefined);
    hits.forEach((hit, i) => found.push({ hit, ref: i === 0 ? base : `${base}#${i + 1}`, date, start }));
  }
  const home = homeCity(found);
  const signals: TasteSignal[] = [];
  for (const { hit, ref, date } of found) {
    if (home && hit.flight && fold(hit.name) === home) continue;
    const s = makeSignal({ source, ref, kind: hit.kind, name: hit.name, city: hit.city, countryCode: hit.countryCode, date, note: hit.note });
    if (s) signals.push(s);
  }
  // The same stay or dinner in two calendars: one per place per day.
  const sameVisit = (s: TasteSignal) => `${s.kind}\u0000${nameKey(s.name)}\u0000${s.date ?? ""}`;
  return collapse(collapse(signals, sameVisit), refKey).slice(0, MAX_IMPORT_SIGNALS);
}

/** Google's id for one occurrence of a repeating event: "<series id>_20250514T190000Z" or "<series id>_20250514". */
const GOOGLE_OCCURRENCE = /_\d{8}(?:T\d{6}Z?)?$/;

/** Ids seen at more than one start: a phone lists every occurrence of a repeating event under one id. */
function repeatingIds(events: CalendarEventLike[]): Set<string> {
  const firstStart = new Map<string, string>();
  const repeating = new Set<string>();
  for (const ev of events) {
    const id = typeof ev.id === "string" ? ev.id.trim() : "";
    if (!id) continue;
    const start = asIso(ev.start);
    const seen = firstStart.get(id);
    if (seen === undefined) firstStart.set(id, start);
    else if (seen !== start) repeating.add(id);
  }
  return repeating;
}

/** start/end as given; a Date (from a caller that skipped the mapping) becomes its ISO string. */
const asIso = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : "";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * The day an event took place. All-day dates and local times are read as written, and so is a
 * time with an offset (it's local there); a UTC time is moved into the event's zone, or this
 * device's, so an 8pm dinner in New York isn't dated the next day.
 */
function eventDay(start: string, timeZone: string | undefined): string | null {
  const day = dateFromText(start);
  if (!day || !/T\d{2}:\d{2}/.test(start)) return day;
  const utc = /Z$/i.test(start);
  if (!utc && !(timeZone && /[+-]\d{2}:?\d{2}$/.test(start))) return day;
  const ms = Date.parse(start);
  return Number.isFinite(ms) ? (dayInZone(ms, timeZone) ?? day) : day;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const DAY_FORMATS = new Map<string, Intl.DateTimeFormat | null>();

/** The day of an instant in an IANA zone, or in this device's zone when there's none or it isn't known here. */
function dayInZone(ms: number, timeZone: string | undefined): string | null {
  const format = timeZone ? dayFormat(timeZone) : null;
  if (format) {
    try {
      const parts = format.formatToParts(new Date(ms));
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      const day = validDay(`${get("year")}-${get("month")}-${get("day")}`);
      if (day) return day;
    } catch {
      // fall through to this device's zone
    }
  }
  const d = new Date(ms);
  return validDay(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
}

/** One formatter per zone: building them is slow, and a calendar has thousands of events in one zone. */
function dayFormat(timeZone: string): Intl.DateTimeFormat | null {
  let f = DAY_FORMATS.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      f = null; // not a zone this runtime knows
    }
    if (DAY_FORMATS.size < 100) DAY_FORMATS.set(timeZone, f);
  }
  return f;
}

/** Longer than a day: an all-day event over two days or more, or a timed one of 20 hours or more. */
function isLong(start: string, end: string): boolean {
  if (!start || !end) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    const a = dateFromText(start);
    const b = dateFromText(end);
    return !!a && !!b && Date.parse(b) - Date.parse(a) >= 2 * 864e5;
  }
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 20 * 3600e3;
}

/**
 * Where the traveler lives, so flights home aren't counted as trips: the origin of the earliest
 * flight with a known origin (unless an earlier flight went there, which makes it a trip's
 * return leg), or else a destination flown to at least twice and more than any other. Needs at
 * least two flights.
 */
function homeCity(hits: { hit: Hit; start: string }[]): string | null {
  const flights = hits.filter((h) => h.hit.flight).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (flights.length < 2) return null;
  const first = flights.findIndex((f) => f.hit.flight?.origin);
  const origin = first >= 0 ? fold(flights[first]!.hit.flight!.origin!) : null;
  if (origin && !flights.slice(0, first).some((f) => fold(f.hit.name) === origin)) return origin;
  const counts = new Map<string, number>();
  for (const f of flights) counts.set(fold(f.hit.name), (counts.get(fold(f.hit.name)) ?? 0) + 1);
  const [top, next] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] >= 2 && (!next || top[1] > next[1]) ? top[0] : null;
}

// ---------------------------------------------------------------------------
// Classifying one event
// ---------------------------------------------------------------------------

/** What the classifiers look at. */
interface Ev {
  /** The title without emoji. */
  summary: string;
  description: string;
  location: string;
  /** City and country of the location, parsed only once an event turns out to be travel. */
  where: () => AddressParts;
  allDay: boolean;
  /** Longer than a day: a trip rather than an afternoon. */
  long: boolean;
  /** A flag in the title ("Lisbon 🇵🇹") as a country code. */
  flagCc: string | null;
}

/** To-dos about travel aren't travel. */
const TODO = /^(?:book|buy|search|find|look(?:ing)? (?:at|for|into)|research|cancel|change|compare|price|email|call|pay|plan|confirm|reschedule|todo|to do|remind(?:er)?)\b/i;
/** Work, chores and appointments. */
const IGNORE =
  /\b(?:meeting|mtg|calls?|sync|stand-?up|1:1|1-1|one[- ]on[- ]one|interview|webinar|zoom|teams|hangout|google meet|demo|review|retro|planning|catch[- ]?up|office hours|deadline|due|birthday|bday|gym|workout|training|doctor|dentist|appointment|appt|therapy|haircut|pick[- ]?up|drop[- ]?off|school|lecture|exam|practice|rehearsal|payday|rent|reminder|todo|ooo|out of office|wfh|work from home|conference|offsite|off-site|summit|kick-?off|onboarding|presentation|pitch|class)\b/i;
/** IGNORE without "class": a cooking class is an activity, a meeting isn't. */
const WORK =
  /\b(?:meeting|mtg|calls?|sync|stand-?up|1:1|1-1|one[- ]on[- ]one|interview|webinar|zoom|teams|hangout|google meet|demo|review|retro|planning|catch[- ]?up|office hours|deadline|due|birthday|bday|doctor|dentist|appointment|appt|therapy|school|lecture|exam|conference|offsite|off-site|summit|kick-?off|onboarding|presentation|pitch|client|recruiting)\b/i;
/** Someone's home or the office, not a venue. */
const PRIVATE_PLACE = /\b(?:my|our|his|her|their|your|mom|mum|moms|mums|dad|dads|parents|grandma|grandpa|nana|home|office|work)\b/;
const GENERIC_VENUE = /^(?:the )?(?:hotel|restaurant|bar|cafe|airport|station|beach|pool|park|tbd|tba|tbc|somewhere|downtown|city|town|place|airbnb|hostel|reservation|booking|dinner|lunch|room)$/;
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}️‍]/gu;

function classify(ev: CalendarEventLike, start: string): Hit[] {
  const raw = typeof ev.summary === "string" ? ev.summary.replace(/\s+/g, " ").trim() : "";
  if (!raw || raw.length > 200 || TODO.test(raw)) return [];
  const flight = flightHit(raw);
  if (flight) return [flight];
  const location = typeof ev.location === "string" ? ev.location.slice(0, 300).replace(/\s+/g, " ").trim() : "";
  let parsed: AddressParts | null = null;
  const e: Ev = {
    summary: raw.replace(EMOJI, " ").replace(/\s+/g, " ").replace(/^[\s:–—|-]+|[\s:–—|-]+$/g, "").trim(),
    // Booking sites are named near the top; long notes (agendas, pasted emails) aren't read further.
    description: typeof ev.description === "string" ? ev.description.slice(0, 2000) : "",
    location,
    where: () => (parsed ??= parseAddress(location)),
    allDay: /^\d{4}-\d{2}-\d{2}$/.test(start),
    long: isLong(start, asIso(ev.end)),
    flagCc: flagCountry(raw),
  };
  if (!e.summary) return flagTrip(e) ?? [];
  return stayHit(e) ?? mealHit(e) ?? activityHit(e) ?? bookedHit(e) ?? tripHits(e) ?? [];
}

/** "🇵🇹" → "PT". */
function flagCountry(s: string): string | null {
  const m = s.match(/(\p{Regional_Indicator})(\p{Regional_Indicator})/u);
  if (!m) return null;
  const code = String.fromCharCode(m[1]!.codePointAt(0)! - 0x1f1e6 + 65, m[2]!.codePointAt(0)! - 0x1f1e6 + 65);
  return isCountryCode(code) ? code : null;
}

/** Trailing detail that isn't part of a venue's name: "(2 nights)", "with Sam", "for 4", "at 8pm", "- confirmation #123". */
function cleanVenue(x: string): string {
  return x
    .replace(/\s*[([][^)\]]*[)\]]\s*$/g, " ")
    .replace(/\s+(?:with|w\/|w\.|for|party of)\s.*$/i, "")
    .replace(/\s+(?:at|@)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|h)?\s*$/i, "")
    .replace(/\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*$/i, "")
    .replace(/\s*[-–—|·:]\s*(?:confirmation|confirmed|booking|reservation|conf\b|#).*$/i, "")
    .replace(/\s*#\s*[\w-]+\s*$/, "")
    .replace(/[\s,.;:!–—-]+$/, "")
    .trim();
}

/**
 * A plausible venue name; a lone possessive ("Sarah's") counts only with a booking or a matching
 * location. Names may start with a number ("11 Madison Park", "1 Hotel South Beach"), but times
 * ("8pm"), party sizes ("2 guests") and street addresses aren't venues.
 */
function isVenue(x: string, location: string, confirmed: boolean): boolean {
  const f = fold(x);
  if (!f || x.length > 100 || PRIVATE_PLACE.test(f) || GENERIC_VENUE.test(f) || IGNORE.test(x)) return false;
  if (/^\d/.test(x) && (!/^\d[\w.:/-]*\s+\p{Lu}/u.test(x) || /^\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/i.test(x) || isStreetLine(x))) return false;
  if (/^\p{L}+['’]s$/u.test(x) && !confirmed && !fold(location).includes(f.replace(/ s$/, ""))) return false;
  return true;
}

/** City for a venue: from the event's location, else a known city at the end of the name ("The Ritz-Carlton, Kyoto"). */
function venueCity(name: string, where: AddressParts): AddressParts {
  if (where.city) return where;
  const tail = name.match(/(?:,|\bin)\s+([^,]+)$/i)?.[1];
  const known = tail ? knownCity(tail) : null;
  return known ? { city: known.city, countryCode: known.countryCode } : where;
}

/** A city, country or US state on its own: "Lisbon", "Portugal", "Hawaii". */
function knownPlace(text: string): { name: string; city: string | null; countryCode: string } | null {
  const t = text.trim();
  if (!t || /\d/.test(t)) return null;
  const country = countryCodeFromName(t);
  if (country) return { name: countryName(country), city: null, countryCode: country };
  const city = knownCity(t);
  if (city) return { name: city.city, city: city.city, countryCode: city.countryCode };
  const state = usStateName(t);
  return state ? { name: state, city: null, countryCode: "US" } : null;
}

/** The first known city named in a text, by its capitalized words: "Sintra Day Trip from Lisbon" → Sintra. */
function cityInText(text: string): AddressParts | null {
  const words = text.split(/[\s,()&/|·:–—-]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      if (!/^\p{Lu}/u.test(phrase)) continue;
      const known = knownCity(phrase);
      if (known) return { city: known.city, countryCode: known.countryCode };
    }
  }
  return null;
}

/** Places that aren't venues: rooms, calls, homes, coworking. */
const NOT_A_VENUE_LOCATION =
  /\b(?:room|rm|floor|fl|suite|ste|unit|building|bldg|office|desk|lobby|campus|zoom|teams|meet|webex|hangouts?|call|phone|online|virtual|remote|tbd|tba|home|house|apartment|apt|place|condo|flat|wework|regus|industrious|cowork(?:ing)?)\b|https?:|www\.|@/i;

/** "51 Grove St", "R. Garrett 120", "97 Wythe Ave"; not "75004 Paris" or "NY 10012". */
const isAddressLine = (p: string) => isStreetLine(p) || (/^\d{1,5}[a-z]?\s+\p{L}{2,}/iu.test(p) && !knownPlace(p.replace(/^\d+[a-z]?\s+/i, "")));

/**
 * The venue a calendar app wrote into the location: "Via Carota, 51 Grove St, New York, NY 10014"
 * → "Via Carota". The name must come before its street address (a neighborhood may sit between:
 * "The Hoxton, Williamsburg, 97 Wythe Ave"), or say what it is ("Joe's Pizza").
 */
function venueFromLocation(location: string): string | null {
  const parts = location.split(/\s*[,，、،]\s*/).filter(Boolean);
  const first = parts[0]?.trim() ?? "";
  if (!first || first.length > 60 || !/\p{L}/u.test(first) || /^\d/.test(first) || isStreetLine(first)) return null;
  if (NOT_A_VENUE_LOCATION.test(first) || PRIVATE_PLACE.test(fold(first)) || /^\p{L}+['’]s$/u.test(first) || knownPlace(first)) return null;
  if (parts.length > 1) return parts.slice(1, 3).some(isAddressLine) ? first : null;
  const k = matchKind(first);
  return k === "food" || k === "drink" || k === "coffee" || k === "nightlife" || k === "stay" ? first : null;
}

// ---------------------------------------------------------------------------
// Booking sites
// ---------------------------------------------------------------------------

type SiteGroup = "stay" | "food" | "activity";

const SITE_LIST: readonly (readonly [SiteGroup, string, RegExp])[] = [
  ["stay", "Booking.com", /booking\.com/i],
  ["stay", "Airbnb", /\bairbnb\b(?! experiences?)/i],
  ["stay", "Vrbo", /\bvrbo\b/i],
  ["stay", "Expedia", /\bexpedia\b/i],
  ["stay", "Hotels.com", /hotels\.com/i],
  ["stay", "Agoda", /\bagoda\b/i],
  ["stay", "Hostelworld", /hostelworld/i],
  ["stay", "Marriott Bonvoy", /marriott bonvoy/i],
  ["stay", "Hilton Honors", /hilton honors/i],
  ["stay", "World of Hyatt", /world of hyatt/i],
  ["food", "Resy", /\bresy\b/i],
  ["food", "OpenTable", /\bopen ?table\b/i],
  ["food", "Tock", /\btock\b|exploretock/i],
  ["food", "SevenRooms", /\bseven ?rooms\b/i],
  ["food", "TheFork", /\bthe ?fork\b|lafourchette/i],
  ["food", "TableCheck", /\btablecheck\b/i],
  ["food", "Quandoo", /\bquandoo\b/i],
  ["activity", "GetYourGuide", /\bget ?your ?guide\b/i],
  ["activity", "Viator", /\bviator\b/i],
  ["activity", "Klook", /\bklook\b/i],
  ["activity", "Tiqets", /\btiqets\b/i],
  ["activity", "Headout", /\bheadout\b/i],
  ["activity", "Musement", /\bmusement\b/i],
  ["activity", "Airbnb Experiences", /\bairbnb experiences?\b/i],
  ["activity", "Eventbrite", /\beventbrite\b/i],
  ["activity", "Ticketmaster", /\bticketmaster\b/i],
  ["activity", "Live Nation", /\blive ?nation\b/i],
  ["activity", "AXS", /\baxs\b/i],
  ["activity", "SeatGeek", /\bseat ?geek\b/i],
  ["activity", "StubHub", /\bstub ?hub\b/i],
  ["activity", "DICE", /\bdice\.fm\b/i],
  ["activity", "TodayTix", /\btoday ?tix\b/i],
];

interface Sites {
  /** Matches when any of them is named: one pass over the text before finding which. */
  any: RegExp;
  list: readonly (readonly [string, RegExp])[];
  /** "Resy: Lilia", "OpenTable reservation at Carbone" */
  prefix: RegExp;
  /** "Lilia (Resy)", "Lilia - OpenTable", "Lilia via Resy" */
  suffix: RegExp;
}

function sites(group: SiteGroup): Sites {
  const list = SITE_LIST.filter(([g]) => g === group).map(([, name, re]) => [name, re] as const);
  const alt = list.map(([, re]) => re.source).join("|");
  const extra = "(?:\\s+(?:reservation|booking|tickets?))?";
  return {
    any: new RegExp(alt, "i"),
    list,
    prefix: new RegExp(`^(?:${alt})\\s*(?:[:\\-–—|·]\\s*|(?=(?:reservation|booking|res|tickets?)\\b))(.+)$`, "i"),
    suffix: new RegExp(`^(.+?)\\s*(?:[([]\\s*(?:${alt})${extra}\\s*[)\\]]|(?:[-–—|·]|\\bvia\\b|\\bthrough\\b)\\s*(?:${alt})${extra})\\s*$`, "i"),
  };
}
const STAY_SITES = sites("stay");
const FOOD_SITES = sites("food");
const ACTIVITY_SITES = sites("activity");

/** The booking site named in a text, if any. */
const siteIn = (text: string, s: Sites) => (s.any.test(text) ? (s.list.find(([, re]) => re.test(text))?.[0] ?? null) : null);
/** The title without its booking site: "Resy: Lilia" → "Lilia", "Lilia (Resy)" → "Lilia"; null when no site is named that way. */
const withoutSite = (title: string, s: Sites) => (title.match(s.prefix)?.[1] ?? title.match(s.suffix)?.[1] ?? null)?.trim() || null;

/** Words that come with a booking: in a title or the notes, they make a bare name with a booking site a reservation. */
const BOOKED = /\b(?:reservations?|reserved|booking|booked|party of|table for|guests?|covers|confirmation|confirmed|itinerary|check-?in|tickets?|voucher|order)\b/i;

// ---------------------------------------------------------------------------
// Stays
// ---------------------------------------------------------------------------

/** "Stay at X", "Staying at X", "Check-in: X", "Lodging - X" */
const STAY_AT = /^(?:hotel\s+)?(stay(?:ing)?|lodging|accommodations?|check[- ]?in)\s*(?:at(?=\s)|@|:|-|–|—)\s*(.+)$/i;
/** "Hotel: X", "Hotel reservation at X", "Airbnb in Lisbon" (not "Hotel Indigo") */
const LODGING_AT = /^(hotel|hôtel|hostel|ryokan|riad|airbnb|vrbo|b&b|guest ?house)\s*(?:reservation|booking|stay|confirmation|check[- ]?in)?\s*(:|-|–|—|@|at(?=\s)|in(?=\s))\s*(.+)$/i;
/** "Reservation at Hotel X", "Your booking at X" */
const BOOKING_AT = /^(?:your\s+)?(?:\w+\s+)?(?:reservation|booking|stay|confirmation|reserva)\s+(?:confirmed\s+)?(?:at|for|@)\s+(.+)$/i;
/** Just "Airbnb" or "Hotel check-in" (fold()ed): the place, if anywhere, is in the location. */
const GENERIC_STAY = /^(hotel|airbnb|vrbo|hostel|b and b|bnb|guest ?house|accommodation|lodging|vacation rental|rental)(?: (?:stay|check ?in|reservation|booking))?$/;
const STAY_FILLER = /\b(?:hotel|hostel|airbnb|booking|reservation|stay|check|in|out|confirmation|accommodation|lodging|room|rooms|night|nights|the|a|my|our)\b/g;
const LODGING_LABEL: Record<string, string> = { hotel: "Hotel", hôtel: "Hôtel", hostel: "Hostel", ryokan: "Ryokan", riad: "Riad", airbnb: "Airbnb", vrbo: "Vrbo", "b&b": "B&B" };

function stayHit(e: Ev): Hit[] | null {
  if (ACTIVITY_SITES.any.test(e.summary)) return null; // "Airbnb Experience: …" isn't a stay
  const site = siteIn(`${e.summary}\n${e.description}`, STAY_SITES);
  const rest = withoutSite(e.summary, STAY_SITES);
  const title = rest ?? e.summary;
  const note = site ? `${site} reservation` : null;
  const stay = (rawName: string, label: string = site ?? "Stay"): Hit[] | null => {
    const name = cleanVenue(rawName);
    if (!isVenue(name, e.location, !!site)) return null;
    // "Lisbon (Airbnb)", "Hotel in Porto": a stay in a city rather than at a named place
    const p = knownPlace(name);
    if (p) return [{ kind: "stay", name: `${label} in ${p.name}`, city: p.city, countryCode: p.countryCode, note }];
    const c = venueCity(name, e.where());
    return [{ kind: "stay", name, city: c.city, countryCode: c.countryCode, note }];
  };

  let m = title.match(STAY_AT);
  if (m) {
    const checkIn = /^check/i.test(m[1]!);
    return !checkIn || matchKind(m[2]!) === "stay" || site || e.location ? stay(m[2]!) : null;
  }
  m = title.match(LODGING_AT);
  if (m) return stay(m[3]!, site ?? LODGING_LABEL[m[1]!.toLowerCase()] ?? "Stay");
  m = title.match(BOOKING_AT);
  if (m && (site || matchKind(m[1]!) === "stay")) return stay(m[1]!);
  // "Booking.com: Memmo Alfama", "Memmo Alfama (Booking.com)"
  if (rest) return stay(rest);
  const g = fold(title).match(GENERIC_STAY);
  if (g) {
    const venue = venueFromLocation(e.location);
    if (venue) return stay(venue);
    const w = e.where();
    const label = site ?? LODGING_LABEL[g[1]!] ?? "Stay";
    return w.city ? [{ kind: "stay", name: `${label} in ${w.city}`, city: w.city, countryCode: w.countryCode, note }] : null;
  }
  // A title that is itself a hotel: "Hotel Avenida Palace", "Four Seasons Resort Bali"
  if (matchKind(title) === "stay" && !IGNORE.test(title) && title.split(" ").length <= 8) {
    const at = title.match(/^.*?\b(?:at|@)\s+(.+)$/i);
    const name = (at && matchKind(at[1]!) === "stay" ? at[1]! : title).replace(/^(?:check[- ]?in|stay|hotel stay)\s*[:\-–—]?\s*/i, "");
    if (fold(name).replace(STAY_FILLER, "").trim()) return stay(name);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Restaurants, bars and cafés
// ---------------------------------------------------------------------------

const MEAL = "breakfast|brunch|lunch|dinner|supper|drinks|cocktails|happy hour|coffee|tea|dessert|tasting menu|omakase|date night";
/** "Dinner at X", "Team lunch @ X", "Brunch w/ Sam at X" */
const MEAL_AT = new RegExp(`^((?:[\\p{L}'’-]+\\s+){0,2}?)(${MEAL})\\b(.*?)\\s(?:at\\s+|@\\s*)(.+)$`, "iu");
/** "Dinner: X", "Drinks - X" */
const MEAL_COLON = new RegExp(`^(${MEAL})\\s*[:\\-–—|]\\s*(.+)$`, "i");
/** "Dinner", "Team lunch", "Lunch with Sam": the place may be in the location. */
const BARE_MEAL = new RegExp(`^((?:[\\p{L}'’-]+\\s+){0,2}?)(${MEAL})(?:\\s+(?:with|w\\/|w\\.|for)\\s.+)?$`, "iu");
/** "Call about dinner at X" isn't a dinner; "Birthday dinner at X" is. */
const MEAL_NOT = /\b(?:call|calls|meeting|mtg|zoom|interview|prep|plan|planning|book|cancel|confirm|email)\b/i;
const PARTY = "(?:\\s+(?:confirmed|for\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\\s+(?:people|guests|ppl|pax|persons))?))?";
/** "Reservation at X", "Table for 2 at X", "Dinner reservation: X" */
const RESERVATION_AT = new RegExp(`^(?:your\\s+)?(?:(?:dinner|lunch|brunch|restaurant)\\s+)?(?:reservation|booking|res|table)${PARTY}\\s*(?:at(?=\\s)|@|:|-|–|—)\\s*(.+)$`, "i");
/** "Alinea reservation", "Lilia - Reservation for 2" */
const RESERVATION_AFTER = new RegExp(`^(.+?)\\s*(?:[-–—|:]\\s*)?(?:(?:dinner|lunch|brunch)\\s+)?(?:reservation|booking|res\\.?)${PARTY}\\s*$`, "i");
const PARTY_SIZE = /\s*[,:\-–—]?\s*(?:for|party of)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*$/i;
const TRAILING_MEAL = /\s+(?:breakfast|brunch|lunch|dinner|supper|drinks|reservation)$/i;

const mealKind = (meal: string): SignalKind => (/drinks|cocktails|happy hour/i.test(meal) ? "drink" : /coffee|tea/i.test(meal) ? "coffee" : "food");
/** A reservation is at a restaurant unless the name says bar or café. */
function reservationKind(name: string): SignalKind {
  const k = matchKind(name);
  return k === "drink" || k === "coffee" || k === "food" ? k : k === "nightlife" ? "drink" : "food";
}
const isFoodish = (name: string) => ["food", "drink", "coffee", "nightlife"].includes(matchKind(name) ?? "");

function mealHit(e: Ev): Hit[] | null {
  const site = siteIn(`${e.summary}\n${e.description}`, FOOD_SITES);
  const rest = withoutSite(e.summary, FOOD_SITES);
  const title = rest ?? e.summary;
  const venue = (rawName: string, kind: SignalKind | null): Hit[] | null => {
    const name = cleanVenue(rawName.replace(/^\d{1,2}(?::\d{2})?\s*(?:am|pm|h)?\s+(?:at|@)\s+/i, ""));
    if (!isVenue(name, e.location, !!site) || knownPlace(name)) return null;
    const c = venueCity(name, e.where());
    return [{ kind: kind ?? reservationKind(name), name, city: c.city, countryCode: c.countryCode, note: site ? `${site} reservation` : null }];
  };

  let m = title.match(MEAL_AT);
  if (m && !MEAL_NOT.test(m[1]!)) return venue(m[4]!, mealKind(m[2]!));
  m = title.match(MEAL_COLON);
  if (m) return venue(m[2]!, mealKind(m[1]!));
  m = title.match(RESERVATION_AT);
  if (m) return venue(m[1]!, null);
  m = title.match(RESERVATION_AFTER);
  if (m && (site || isFoodish(m[1]!))) return venue(m[1]!, null);
  // "Resy: Lilia", "Lilia (Resy)": the rest of the title is the restaurant
  if (rest && !isActivityTitle(rest)) return venue(rest.replace(TRAILING_MEAL, ""), null);
  // "Dinner", "Lunch with Sam", with the restaurant in the location
  m = title.match(BARE_MEAL);
  if (m && !MEAL_NOT.test(m[1]!)) {
    const v = venueFromLocation(e.location);
    const k = v ? matchKind(v) : null;
    if (v && k !== "sight" && k !== "activity") return venue(v, mealKind(m[2]!));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tours, tickets, classes and tastings
// ---------------------------------------------------------------------------

const TOUR_KINDS =
  "walking|food|wine|city|boat|bike|bicycle|e-?bike|segway|tuk[- ]?tuk|guided|private|small[- ]group|street food|street art|history|historical|architecture|" +
  "fado|tapas|pintxos|pub|bar|brewery|distillery|winery|vineyard|helicopter|jeep|desert|snorkel(?:ing)?|kayak|catamaran|sailing|sunset|night|ghost|" +
  "museum|gallery|sightseeing|hop[- ]on hop[- ]off|harbou?r|river|canal|island|cave|glacier|whale|dolphin|wildlife|photo|photography|culinary|market|" +
  "chocolate|cheese|sake|whisk(?:e)?y|cocktail|day";
const TASTINGS = "wine|whisk(?:e)?y|sake|beer|mezcal|tequila|olive oil|chocolate|cheese|coffee|tea|port|rum|gin|cider";
const CLASSES =
  "cooking|pasta|sushi|baking|bread|cocktail|mixology|wine|coffee|barista|dumpling|ramen|paella|taco|pastry|chocolate|cheese|pizza|gelato|tea|pottery|" +
  "ceramics|painting|tango|salsa|flamenco|surf|surfing|scuba|diving|sailing|ski|snowboard|glassblowing|perfume|leather|jewell?ery|jewelry|calligraphy";
/** Unmistakable activities: "Walking tour", "Wine tasting", "Pasta making class", "Fado show", "Louvre tickets". */
const ACTIVITY_WORDS = new RegExp(
  `\\b(?:(?:${TOUR_KINDS})\\s+(?:tours?|cruises?|excursions?|safaris?|walks?)` +
    `|(?:${TASTINGS})\\s+tastings?` +
    `|(?:${CLASSES})\\s+(?:making\\s+)?(?:class(?:es)?|workshops?|lessons?|courses?)` +
    "|(?:pub|bar|food|tapas|pintxos|wine)\\s+crawls?|tea ceremony|hot air balloon|zip ?lin(?:e|ing)|bungee|sky ?diving|paragliding|parasailing|" +
    "scuba diving|snorkel(?:ing|ling)|whale watching|horse(?:back)? riding|safari|excursions?" +
    "|(?:comedy|magic|fado|flamenco|drag|cabaret|broadway|jazz|light|dinner|burlesque|circus)\\s+shows?|concert|e-?tickets?|tickets?|admission)\\b",
  "i",
);
/** "Alhambra tour", "The Eras Tour", "Tour of the Vatican Museums", "Tour: Sintra" (case matters). */
const NAMED_TOUR = /(?:^|\s)\p{Lu}[\p{L}'’.&-]*(?:\s+[\p{L}'’.&-]+){0,4}\s+[Tt]ours?$/u;
const TOUR_OF = /\b[Tt]ours?\s+(?:of|at|around|through)\s+(?:the\s+)?\p{Lu}/u;
const LABELLED = /^(?:[Tt]ours?|[Ee]xcursion|[Aa]ctivity|[Ee]xperience|[Tt]ickets?|[Ee]-?tickets?)\s*[:\-–—]\s*\S/u;
/** Viewings, campus visits, support tickets and train tickets aren't activities. */
const NOT_ACTIVITY = new RegExp(
  "\\b(?:(?:apartment|apt|home|condo|loft|property|listing|open house|campus|school|college|university|daycare|preschool|nursery|kindergarten|" +
    "facility|plant|office|site|venue|product|platform|virtual|online)\\s+(?:tours?|visits?|showings?)" +
    "|tours?\\s+(?:of|at)\\s+(?:the\\s+)?(?:apartment|apt|home|house|condo|loft|property|office|campus|school|facility|plant|site|venue)" +
    "|(?:train|bus|ferry|metro|subway|parking|speeding|traffic|lottery|raffle|support|jira|zendesk|helpdesk|it|bug|plane|airline|flight|boarding)\\s+(?:e-?)?tickets?" +
    "|tickets?\\s+(?:#|no\\.?\\s*)?\\d|on sale|pre-?sale)\\b|^(?:a |the )?house tours?$",
  "i",
);

function isActivityTitle(t: string): boolean {
  return ACTIVITY_WORDS.test(t) || NAMED_TOUR.test(t) || TOUR_OF.test(t) || LABELLED.test(t);
}

/** "Tickets: Louvre Museum" → "Louvre Museum", "Hamilton - Tickets" → "Hamilton", "Your booking for X" → "X". */
function cleanActivity(t: string): string {
  return cleanVenue(
    t
      .replace(/^(?:your\s+)?(?:booking|reservation|confirmation|order|tickets?|e-?tickets?|tour|excursion|activity|experience)(?:\s+confirmed)?\s*[:\-–—]\s*/i, "")
      .replace(/^(?:your\s+)?(?:tickets?|e-?tickets?|booking|reservation)\s+(?:for|to)\s+/i, "")
      .replace(/\s*[-–—|:]\s*(?:tickets?|e-?tickets?|booking|reservation|confirmation|confirmed|admission)\b.*$/i, "")
      .replace(/\s+(?:tickets?|e-?tickets?|admission)$/i, ""),
  );
}

function activityHit(e: Ev): Hit[] | null {
  const text = `${e.summary}\n${e.description}`;
  const site = siteIn(text, ACTIVITY_SITES);
  const viaSite = withoutSite(e.summary, ACTIVITY_SITES);
  const title = viaSite ?? withoutSite(e.summary, FOOD_SITES) ?? e.summary; // "Tock: Wine tasting at Ridge"
  const booked = viaSite != null || (site != null && BOOKED.test(text));
  if (!booked && !isActivityTitle(title)) return null;
  if (NOT_ACTIVITY.test(title) || WORK.test(title) || PRIVATE_PLACE.test(fold(title))) return null;
  const name = cleanActivity(title);
  if (!name || name.length > 100 || !/\p{L}/u.test(name) || /^\d+(?:\s+\p{L}+)?$/u.test(name) || GENERIC_VENUE.test(fold(name))) return null;
  const w = e.where();
  const c = w.city ? w : (cityInText(name) ?? w);
  return [{ kind: "activity", name, city: c.city, countryCode: c.countryCode, note: site ? `${site} booking` : null }];
}

// ---------------------------------------------------------------------------
// A bare name with a booking site in the notes
// ---------------------------------------------------------------------------

/** "Lilia" with "Resy · Party of 2" in the notes; "Memmo Alfama" with "Booking.com confirmation 4412". */
function bookedHit(e: Ev): Hit[] | null {
  const text = `${e.summary}\n${e.description}`;
  if (!BOOKED.test(text) || IGNORE.test(e.summary) || e.summary.split(" ").length > 8) return null;
  const food = siteIn(text, FOOD_SITES);
  const stay = food ? null : siteIn(text, STAY_SITES);
  if (!food && !stay) return null;
  const name = cleanVenue(e.summary.replace(PARTY_SIZE, "").replace(TRAILING_MEAL, ""));
  if (!isVenue(name, e.location, true)) return null;
  const p = knownPlace(name);
  if (p) return stay ? [{ kind: "stay", name: `${stay} in ${p.name}`, city: p.city, countryCode: p.countryCode, note: `${stay} reservation` }] : null;
  const c = venueCity(name, e.where());
  return food
    ? [{ kind: reservationKind(name), name, city: c.city, countryCode: c.countryCode, note: `${food} reservation` }]
    : [{ kind: "stay", name, city: c.city, countryCode: c.countryCode, note: `${stay} reservation` }];
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

const TRIP_STRONG = "trip|travel(?:l?ing)?|vacation|vacay|holidays?|getaway|honeymoon|babymoon|road ?trip|day ?trip|staycation|stay(?:ing)?";
const TRIP_WEAK = "visit(?:ing)?|weekend|long weekend|journey|escape|retreat|break";
const TRIP_PREFIX = new RegExp(`^(?:([\\p{L}'’-]+)\\s+)?(${TRIP_STRONG}|${TRIP_WEAK})\\s+(?:to|in|at)\\s+(.+)$`, "iu");
const TRIP_WEAK_WORD = new RegExp(`^(?:${TRIP_WEAK})$`, "i");
const TRIP_SUFFIX = /^(.+?)\s+(trip|vacation|vacay|holidays?|getaway|honeymoon|babymoon|weekend|road ?trip)(?:\s+(?:19|20)\d{2})?$/i;
/** "OOO - Lisbon", "PTO (Japan)", "Vacation: Porto" */
const AWAY = /^(?:ooo|pto|out of (?:the )?office|vacation|vacay|holidays?|annual leave)\s*(?:[-:–—|]|\()\s*(.+?)\s*\)?$/i;
const WORK_QUALIFIER = /^(?:business|work|company|team|sales|client|field|school|class|offsite|conference|research|site|recruiting|board|press|training|biz)$/i;
const TRIP_FILLER =
  /\b(?:family|girls|boys|guys|friends|couples?|ski|surf|summer|winter|spring|fall|autumn|christmas|xmas|thanksgiving|easter|birthday|anniversary|bachelor|bachelorette|annual|road|day|long|weekend|work|business|team|company|school|class|camping|fishing|hiking|golf|beach|our|my|the|big|little|mini|epic|bank|public|federal|national|holidays?|(?:19|20)\d{2})\b/gi;
/** Holidays and occasions, which look like places in a title ("Labor Day trip", "Sam's wedding"). */
const NOT_A_PLACE =
  /\b(?:day|eve|night|week|weekend|holidays?|break|season|time|party|celebration|reunion|wedding|funeral|shower|graduation|christmas|xmas|thanksgiving|easter|hanukkah|chanukah|diwali|ramadan|eid|passover|new year|halloween|valentine'?s?|labou?r|memorial|presidents?|independence|mother'?s?|father'?s?|veterans?|mlk|juneteenth|bastille)\b/i;
const ERRAND = /\b(?:business|work|company|team|sales|client|field|school|class|grocery|groceries|errands?|shopping|costco|ikea|target|walmart)\b/i;

/** "known": only a city, country or state we know. "confirmed": somewhere else too, for a stay of a day or more. */
type Level = "known" | "confirmed";

function tripHits(e: Ev): Hit[] | null {
  const s = e.summary;
  let m = s.match(AWAY);
  if (m) return tripPlaces(m[1]!, "known", e);
  m = s.match(TRIP_PREFIX);
  if (m) {
    if (m[1] && (WORK_QUALIFIER.test(m[1]) || IGNORE.test(m[1]))) return null;
    return tripPlaces(m[3]!, TRIP_WEAK_WORD.test(m[2]!) ? "known" : "confirmed", e);
  }
  m = s.match(TRIP_SUFFIX);
  if (m) {
    if (IGNORE.test(m[1]!) || ERRAND.test(m[1]!)) return null;
    const where = m[1]!.replace(TRIP_FILLER, " ").replace(/\s+/g, " ").trim();
    return where ? tripPlaces(where, /^(?:holidays?|weekend)$/i.test(m[2]!) ? "known" : "confirmed", e) : null;
  }
  // An all-day event named after a place: "Lisbon 🇵🇹", "Lisbon" over several days, "Wedding in Napa"
  if (e.allDay && (e.flagCc || e.long)) {
    const tail = s.match(/\b(?:in|to|at)\s+([^,()]+(?:,\s*[^,()]+)?)$/i)?.[1];
    return tripPlaces(s, "known", e) ?? (tail ? tripPlaces(tail, "known", e) : null) ?? flagTrip(e);
  }
  return null;
}

/** "Honeymoon 🇵🇹" over several days → Portugal. */
function flagTrip(e: Ev): Hit[] | null {
  return e.flagCc && (e.allDay || e.long) ? [{ kind: "city", name: countryName(e.flagCc), city: null, countryCode: e.flagCc, note: null }] : null;
}

/** "Lisbon & Porto", "Lisbon, Portugal", "Japan" → one city signal per place. */
function tripPlaces(text: string, level: Level, e: Ev): Hit[] | null {
  const cleaned = text
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\s+(?:with|w\/|for)\s.*$/i, "")
    .replace(/[!?.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // A known name first, so "Trinidad and Tobago" isn't split; then "Lisbon & Porto" → two places.
  const segs = knownPlace(cleaned) ? [cleaned] : cleaned.split(/\s*(?:,|&|\+|\/|\band\b|→|->|\s[–—-]\s)\s*/i).filter(Boolean);
  const trailingCountry = segs.length > 1 ? countryCodeFromName(segs[segs.length - 1]) : null;
  const names = trailingCountry ? segs.slice(0, -1) : segs;
  const hits = names.map((p) => place(p, level, e, trailingCountry)).filter((h): h is Hit => !!h);
  return hits.length ? hits : null;
}

function place(text: string, level: Level, e: Ev, countryHint: string | null): Hit | null {
  const t = text.trim().replace(/^the\s+/i, "");
  if (!t || t.length > 40 || /\d/.test(t) || t.split(/\s+/).length > 4) return null;
  if (PRIVATE_PLACE.test(fold(t)) || IGNORE.test(t) || NOT_A_PLACE.test(t)) return null;
  const known = knownPlace(t);
  if (known) return { kind: "city", name: known.name, city: known.city, countryCode: known.countryCode, note: null };
  if (level === "known") return null;
  // Somewhere we don't know ("Trip to Hudson"): only over a day or more, or with a flag or a matching location.
  const k = matchKind(t);
  if ((k && k !== "sight") || !/^\p{Lu}/u.test(t)) return null;
  const w = e.where();
  if (!e.long && !e.flagCc && !(w.city && fold(w.city) === fold(t))) return null;
  const name = canonicalCity(t);
  return { kind: "city", name, city: name, countryCode: countryHint ?? e.flagCc ?? w.countryCode, note: null };
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

const FLIGHT_WORD = /\b(?:flights?|vuelos?|voos?|vols?|flug|volo|vlucht)\b|✈/iu;
/** Google writes flights in the account's language: "Vuelo a Lisboa", "Voo para Lisboa", "Flug nach Lissabon", "Vol à destination de Paris". */
const LOCAL_FLIGHT = /^(?:vuelos?|voos?|vols?|flug|volo|vlucht)\s+(?:a|al|para|pour|à|nach|per|naar|vers|to)\s+(?:destination\s+(?:de\s+|d['’]\s*))?/i;

/**
 * "Flight to Lisbon (TP 202)", "Flight: JFK → LIS", "✈ New York to Lisbon", "TAP 201 JFK-LIS",
 * "JFK-LIS", "Vuelo a Lisboa (TP 1023)" → the destination city. Without the word "flight" (or ✈)
 * both ends must be known airport codes.
 */
function flightHit(raw: string): Hit | null {
  const summary = raw.replace(LOCAL_FLIGHT, "Flight to ");
  const hasWord = FLIGHT_WORD.test(summary);
  if (!hasWord && !/\b[A-Z]{3}\b.*\b[A-Z]{3}\b/.test(summary)) return null; // without the word, two airport codes are needed
  let s = summary.replace(/✈️?/gu, " → ");
  let flightNo: string | null = null;
  const two = s.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/);
  const three = two ? null : s.match(/\b([A-Z]{3})\s?(\d{1,4})\b/);
  if (two) {
    flightNo = `${two[1]} ${two[2]}`;
    s = s.replace(two[0], " ");
  } else if (three && !airportByCode(three[1]!)) {
    flightNo = `${three[1]} ${three[2]}`;
    s = s.replace(three[0], " ");
  }
  s = s
    .replace(/\(\s*\)/g, " ")
    .replace(/\b(?:flights?|vuelos?|voos?|vols?|flug|volo|vlucht)\b/gi, " ")
    .replace(/\b(?:departure|departing|depart|departs|outbound|return(?:ing)?|nonstop|non-stop|direct|connecting|layover)\b/gi, " ")
    .replace(/\b([A-Z]{3})\s*[-–—/]\s*([A-Z]{3})\b/g, "$1 → $2");
  let body = s.replace(/\s+/g, " ").replace(/^[\s:,.;–—-]+/, "").replace(/^(?:→|->)\s*/, "").trim();

  let origin: string | null = null;
  let dest: string | null = null;
  const toOnly = body.match(/^to\s+(.+)$/i);
  if (toOnly) dest = toOnly[1]!;
  else {
    const fromFirst = /^from\s+/i.test(body);
    body = body.replace(/^from\s+/i, "");
    const parts = body
      .split(/\s*(?:→|->|➝|➔|⟶|⇒|>|\bto\b|\s[–—-]\s)\s*/i)
      .map((p) => p.replace(/^[\s:,.;-]+|[\s:,.;-]+$/g, "").trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      origin = parts[0]!;
      dest = parts[parts.length - 1]!;
    } else if (fromFirst || !hasWord) return null;
  }
  if (!dest) return null;
  if (!hasWord && !(origin && airportByCode(origin) && airportByCode(dest))) return null;
  const to = flightPlace(dest, hasWord);
  if (!to) return null;
  const from = origin ? flightPlace(origin, false) : null; // only a known origin can tell where home is
  return { kind: "city", name: to.city, city: to.city, countryCode: to.countryCode, note: flightNo ? `Flight ${flightNo}` : "Flight", flight: { origin: from?.city ?? null } };
}

/** An airport code, airport name or city ("Lisbon (LIS)", "London Heathrow", "Lisbon, Portugal"). */
function flightPlace(seg: string, allowUnknown: boolean): { city: string; countryCode: string | null } | null {
  const trimmed = seg.trim();
  const code = trimmed.match(/\(([A-Z]{3})\)/)?.[1] ?? (/^[A-Z]{3}$/.test(trimmed) ? trimmed : null);
  if (code && airportByCode(code)) return airportByCode(code);
  if (/^[A-Z]{3}$/.test(trimmed)) return null; // an airport we don't know
  const byName = airportByName(trimmed);
  if (byName) return byName;
  const t = trimmed
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:international|intl|airport|aeroporto|aeropuerto|aeroport|aéroport|flughafen|terminal\s*\w*)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[,.;:]+$/, "")
    .trim();
  const [cityPart = "", countryPart] = t.split(/\s*,\s*/);
  const words = cityPart.split(" ");
  for (let n = words.length; n >= 1; n--) {
    const known = knownCity(words.slice(0, n).join(" ")); // "Lisbon Humberto Delgado" → Lisbon
    if (known) return known;
  }
  if (!allowUnknown || !cityPart || /\d/.test(cityPart) || cityPart.length > 40 || !/^\p{Lu}/u.test(cityPart)) return null;
  const k = matchKind(cityPart);
  if (k && k !== "sight") return null;
  return { city: canonicalCity(cityPart), countryCode: countryCodeFromName(countryPart) };
}
