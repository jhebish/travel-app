/**
 * Who sees what, and when. Past trips: who each one is for, and hidden dates. Planned trips: shared
 * only once the traveler is home. Plain functions with no zod, so pages can use them in the browser.
 */
import type { Visibility } from "./community";

const DAY_MS = 86_400_000;
/** The day starts last at UTC−12: once a date has begun there, it has begun everywhere. */
const LAST_ZONE_MS = 12 * 3_600_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today as YYYY-MM-DD in the last time zone to reach it, so "the day after" has started wherever the traveler is. */
export function todayEverywhere(now: Date | number = Date.now()): string {
  return isoDay(+now - LAST_ZONE_MS);
}

/** "2026-11-07" → that day at midnight UTC, or null when it isn't a usable date. */
function dayMs(date: unknown): number | null {
  if (typeof date !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

/**
 * The first day a dated trip is over: the day after its last day ("2026-11-10" for three days from
 * 2026-11-07). null when there's no usable start date.
 */
export function dayAfterTrip(startDate: string | null | undefined, days: number | null | undefined): string | null {
  const start = dayMs(startDate);
  if (start == null) return null;
  const n = Number(days);
  return isoDay(start + (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1) * DAY_MS);
}

type DatedRequest = { startDate?: string | null; days?: number | null } | null | undefined;

/** Is this planned trip over, wherever the traveler is? Trips without dates count as over. */
export function tripIsOver(request: DatedRequest, now: Date | number = Date.now()): boolean {
  const after = dayAfterTrip(request?.startDate, request?.days);
  return !after || todayEverywhere(now) >= after;
}

/**
 * Share only after you're home: a planned trip with dates is hidden from everyone but its owner
 * until the day after it ends, unless the owner turned on "Share while I'm away".
 */
export function hiddenWhileAway(t: { request?: DatedRequest; shareWhileAway?: boolean | null }, now: Date | number = Date.now()): boolean {
  return !t.shareWhileAway && !tripIsOver(t.request, now);
}

/**
 * Past trips are dated by year and month, and imports can include trips that haven't happened yet.
 * One counts as over once its month has ended (a trip this month may still be ahead). Trips with no
 * year, or a year in the past, are over; a year with no month counts as over unless it's a later year.
 */
export function pastTripIsOver(p: { year: number | null; month: number | null }, now: Date | number = Date.now()): boolean {
  if (p.year == null) return true;
  const today = todayEverywhere(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (p.year !== year) return p.year < year;
  return p.month == null || p.month < month;
}

/** The first day others can see a past trip that isn't over yet ("2026-12-01"), or null if it's over. */
export function pastTripShownFrom(p: { year: number | null; month: number | null }, now: Date | number = Date.now()): string | null {
  if (pastTripIsOver(p, now) || p.year == null) return null;
  // A later year with no month counts as over once that year begins.
  if (p.month == null) return `${p.year}-01-01`;
  return p.month === 12 ? `${p.year + 1}-01-01` : `${p.year}-${String(p.month + 1).padStart(2, "0")}-01`;
}

export interface PastTripViewer {
  /** It's the viewer's own trip. */
  isOwner: boolean;
  /** The viewer follows the trip's owner. */
  follows: boolean;
}

type PastTripLike = { year: number | null; month: number | null; visibility?: Visibility | null; hideDates?: boolean | null; tripId?: string | null };

/**
 * Can this person see this past trip? Only me: just its owner. Followers: people who follow the
 * owner. Everyone: anyone. Nobody but the owner sees one before it's over.
 */
export function canSeePastTrip(p: PastTripLike, viewer: PastTripViewer, now: Date | number = Date.now()): boolean {
  if (viewer.isOwner) return true;
  if (!pastTripIsOver(p, now)) return false;
  const vis = p.visibility ?? "followers";
  return vis === "public" || (vis === "followers" && viewer.follows);
}

/** A past trip as someone else sees it: no year or month when its dates are hidden, and no link to the owner's own Pylos plan. */
export function pastTripForOthers<T extends PastTripLike>(p: T): T {
  return { ...p, tripId: null, ...(p.hideDates ? { year: null, month: null } : {}) };
}

/** The past trips this person may see, as they may see them. Owners see everything as it is. */
export function visiblePastTrips<T extends PastTripLike>(list: T[], viewer: PastTripViewer, now: Date | number = Date.now()): T[] {
  if (viewer.isOwner) return list;
  return list.filter((p) => canSeePastTrip(p, viewer, now)).map(pastTripForOthers);
}
