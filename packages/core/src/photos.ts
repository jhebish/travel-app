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
 * Home is where most photo days are (several homes if you've moved). Trips are runs of days
 * more than 60 km from home; each place on a trip is its own stay (a route through Italy gives
 * Rome, Florence, Venice). Centres are rounded to about 1 km before they leave the phone.
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
  const away = points.filter((p) => homes.every((h) => km(p, h) > 60)).sort((a, b) => a.day.localeCompare(b.day));

  const runs: { first: PhotoPoint; start: string; end: string; pts: PhotoPoint[] }[] = [];
  for (const p of away) {
    const cur = runs[runs.length - 1];
    if (cur && daysBetween(cur.end, p.day) <= 3 && km(cur.first, p) <= 50) {
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
