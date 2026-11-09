/**
 * Trips from photo locations, worked out on the phone: only rough centres and dates leave it.
 */
const DAY_MS = 864e5;

export interface PhotoPoint {
  day: string;
  lat: number;
  lng: number;
}
const rad = (d: number) => (d * Math.PI) / 180;
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/**
 * Many days of a trip have no photo with a location (screenshots, saved images, days without
 * pictures). Days in the same place stay one trip across a gap of up to this many days, unless a
 * photo at home shows you went back in between.
 */
const SAME_TRIP_GAP = 14;

/**
 * Home is where most photo days are (several homes if you've moved). Trips are runs of days
 * more than 60 km from home; each place on a trip is its own stay (a route through Italy gives
 * Rome, Florence, Venice). A stay runs from its first located photo to its last: days in between
 * with none still count, up to two weeks of them, unless a photo at home shows you went back (or
 * the located days get so sparse that they look like separate visits). Centres are rounded to
 * about 1 km before they leave the phone.
 */
export function photoStays(points: PhotoPoint[]) {
  const cell = (p: PhotoPoint) => `${Math.round(p.lat * 4)},${Math.round(p.lng * 4)}`; // about 25 km
  const cells = new Map<string, { n: number; lat: number; lng: number }>();
  for (const p of points) {
    const c = cells.get(cell(p)) ?? { n: 0, lat: 0, lng: 0 };
    c.n++;
    c.lat += p.lat;
    c.lng += p.lng;
    cells.set(cell(p), c);
  }
  const ranked = [...cells.values()].sort((a, b) => b.n - a.n);
  const homes = ranked.filter((c, i) => i === 0 || c.n >= points.length * 0.15).map((c) => ({ lat: c.lat / c.n, lng: c.lng / c.n }));
  const isAway = (p: PhotoPoint) => homes.every((h) => km(p, h) > 60);
  const away = points.filter(isAway).sort((a, b) => a.day.localeCompare(b.day));
  const homeDays = points.filter((p) => !isAway(p)).map((p) => p.day).sort();
  /** A photo at home on a day strictly between a and b. */
  const wentHome = (a: string, b: string) => {
    let lo = 0;
    let hi = homeDays.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (homeDays[mid]! <= a) lo = mid + 1;
      else hi = mid;
    }
    return lo < homeDays.length && homeDays[lo]! < b;
  };

  const runs: { first: PhotoPoint; start: string; end: string; pts: PhotoPoint[] }[] = [];
  for (const p of away) {
    const cur = runs[runs.length - 1];
    const gap = cur ? daysBetween(cur.end, p.day) : Infinity;
    // Bridging a long gap needs a located day for every four of the stay's days, so weekly
    // visits somewhere don't chain into one stay that lasts months.
    const bridge = !!cur && gap <= SAME_TRIP_GAP && !wentHome(cur.end, p.day) && (cur.pts.length + 1) * 4 >= daysBetween(cur.start, p.day) + 1;
    if (cur && km(cur.first, p) <= 50 && (gap <= 3 || bridge)) {
      cur.end = p.day;
      cur.pts.push(p);
    } else runs.push({ first: p, start: p.day, end: p.day, pts: [p] });
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return runs.map((r) => ({
    lat: round(r.pts.reduce((s, p) => s + p.lat, 0) / r.pts.length),
    lng: round(r.pts.reduce((s, p) => s + p.lng, 0) / r.pts.length),
    start: r.start,
    end: r.end,
    days: Math.min(365, daysBetween(r.start, r.end) + 1),
  }));
}

// ---------------------------------------------------------------------------
// Where someone slept on a trip: the photos taken late at night and early in the morning
// ---------------------------------------------------------------------------
export interface NightPoint {
  /** The night it belongs to (YYYY-MM-DD): a morning photo belongs to the night before. */
  night: string;
  lat: number;
  lng: number;
  when: "evening" | "morning";
}

const HOUR_MS = 36e5;

/**
 * Which night a photo belongs to, if it was taken late in the evening (from 9:30pm) or early in
 * the morning (before 9am) where it was taken. Phones keep photo times in UTC without the place's
 * time zone, so the hour there comes from its longitude (solar time): close enough for this.
 */
export function nightOf(ms: number, lng: number): { night: string; when: "evening" | "morning" } | null {
  const local = new Date(ms + Math.round(lng / 15) * HOUR_MS); // its UTC fields read as the hour there
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (h >= 21.5) return { night: local.toISOString().slice(0, 10), when: "evening" };
  if (h < 9) return { night: new Date(local.getTime() - DAY_MS).toISOString().slice(0, 10), when: "morning" };
  return null;
}

/**
 * The likeliest places someone slept on a stay: spots (photos within about 120 m of each other)
 * seen on two or more nights, or on an evening and a morning. Up to two per stay, for someone who
 * moved hotels, most nights first. The spot is what gets looked up for a hotel name; it isn't kept.
 */
export function sleepSpots(points: NightPoint[]): { lat: number; lng: number; first: string; nights: number }[] {
  const clusters: { lat: number; lng: number; pts: NightPoint[] }[] = [];
  for (const p of [...points].sort((a, b) => a.night.localeCompare(b.night))) {
    const c = clusters.find((x) => km(x, p) <= 0.12);
    if (c) {
      c.pts.push(p);
      c.lat = c.pts.reduce((s, q) => s + q.lat, 0) / c.pts.length;
      c.lng = c.pts.reduce((s, q) => s + q.lng, 0) / c.pts.length;
    } else clusters.push({ lat: p.lat, lng: p.lng, pts: [p] });
  }
  return clusters
    .map((c) => ({ c, nights: new Set(c.pts.map((p) => p.night)).size, both: c.pts.some((p) => p.when === "evening") && c.pts.some((p) => p.when === "morning") }))
    .filter((x) => x.nights >= 2 || x.both)
    .sort((a, b) => b.nights - a.nights || b.c.pts.length - a.c.pts.length)
    .slice(0, 2)
    .map(({ c, nights }) => ({ lat: Math.round(c.lat * 1e4) / 1e4, lng: Math.round(c.lng * 1e4) / 1e4, first: c.pts[0]!.night, nights }));
}
