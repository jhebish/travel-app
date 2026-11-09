import type { Hotel, Itinerary, Stop } from "./schemas";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Best coordinates for a place: verified (Google) first, then the planner's estimate. */
export function coordsOf(p: Stop | Hotel): (LatLng & { verified: boolean }) | null {
  if (p.place?.lat != null && p.place?.lng != null) return { lat: p.place.lat, lng: p.place.lng, verified: true };
  if (p.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng, verified: false };
  return null;
}

/**
 * Where a globe of someone's places should face first: the middle of the side of the world with
 * the most of their trips on it, so as many pins as possible are in view (a world traveller's
 * Europe, say, with the one trip to Japan round the back). Null when there are no places.
 */
export function mapCentre(points: (LatLng & { weight?: number })[]): LatLng | null {
  if (!points.length) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const vs = points.map((p) => {
    const la = rad(p.lat);
    const lo = rad(p.lng);
    return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la), w: Math.max(p.weight ?? 1, 0.01) };
  });
  // In view from a centre: within 70°, short of the globe's rim where pins get squeezed.
  const near = Math.cos(rad(70));
  const inView = (c: (typeof vs)[number]) => vs.filter((v) => v.x * c.x + v.y * c.y + v.z * c.z >= near);
  let best = vs[0]!;
  let bestScore = -1;
  for (const c of vs) {
    const score = inView(c).reduce((s, v) => s + v.w, 0);
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  // Then the weighted middle of what's in view from there.
  const sum = inView(best).reduce((s, v) => ({ x: s.x + v.x * v.w, y: s.y + v.y * v.w, z: s.z + v.z * v.w }), { x: 0, y: 0, z: 0 });
  const len = Math.hypot(sum.x, sum.y, sum.z) || 1;
  const deg = (r: number) => (r * 180) / Math.PI;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { lat: round(deg(Math.asin(Math.max(-1, Math.min(1, sum.z / len))))), lng: round(deg(Math.atan2(sum.y, sum.x))) };
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface Leg {
  km: number;
  minutes: number;
  mode: "walk" | "ride";
  /** True when either end is an estimated (unverified) location. */
  approximate: boolean;
}

/**
 * Rough travel estimate between two stops. Street routes run ~30% longer than
 * straight lines; walking at 4.8 km/h up to ~2 km, otherwise a city ride at ~18 km/h
 * plus 8 minutes of waiting and walking to the vehicle.
 */
export function legBetween(a: Stop, b: Stop): Leg | null {
  const ca = coordsOf(a);
  const cb = coordsOf(b);
  if (!ca || !cb) return null;
  const km = haversineKm(ca, cb) * 1.3;
  if (km > 80) return null; // bad coordinates; don't show nonsense
  const walk = km <= 2;
  const minutes = Math.max(2, Math.round(walk ? (km / 4.8) * 60 : (km / 18) * 60 + 8));
  return { km: Math.round(km * 10) / 10, minutes, mode: walk ? "walk" : "ride", approximate: !ca.verified || !cb.verified };
}

export const legLabel = (l: Leg) => `${l.approximate ? "About " : ""}${l.minutes} min ${l.mode === "walk" ? "walk" : "by taxi or transit"}`;

/** Google Maps directions link for a day, in order. Works on web and opens the app on phones. */
export function googleMapsDayUrl(stops: Stop[], city: string): string {
  const q = (s: Stop) => `${s.name}, ${s.neighborhood ? s.neighborhood + ", " : ""}${city}`;
  const pts = stops.slice(0, 10); // Google allows origin + 8 waypoints + destination
  const params = new URLSearchParams({ api: "1", travelmode: "walking" });
  if (pts.length === 1) {
    const only = pts[0]!;
    const search = new URLSearchParams({ api: "1", query: q(only) });
    if (only.place?.placeId) search.set("query_place_id", only.place.placeId);
    return `https://www.google.com/maps/search/?${search}`;
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  params.set("origin", q(first));
  params.set("destination", q(last));
  if (first.place?.placeId) params.set("origin_place_id", first.place.placeId);
  if (last.place?.placeId) params.set("destination_place_id", last.place.placeId);
  const mid = pts.slice(1, -1);
  if (mid.length) {
    params.set("waypoints", mid.map(q).join("|"));
    if (mid.every((s) => s.place?.placeId)) params.set("waypoint_place_ids", mid.map((s) => s.place!.placeId).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

// ---------------------------------------------------------------------------
// Calendar (.ics)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Fold lines longer than 75 octets, as RFC 5545 requires. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
};

function parseTime(t: string): { h: number; m: number } | null {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/**
 * Build an .ics calendar for the trip. Times are written as "floating" local times,
 * so they land at the right hour in the destination whatever the phone's time zone.
 * Each stop lasts until the next one starts (capped at 3 hours; 90 minutes for the last).
 */
export function buildIcs(it: Itinerary, city: string, startDate: string, tripUrl?: string): string {
  const [y, mo, d] = startDate.split("-").map(Number) as [number, number, number];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pylos//Trip//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(it.title)}`];
  it.days.forEach((day, di) => {
    const date = new Date(Date.UTC(y, mo - 1, d + di));
    const ymd = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
    day.stops.forEach((s, si) => {
      const start = parseTime(s.time);
      if (!start) return;
      const next = day.stops[si + 1] ? parseTime(day.stops[si + 1]!.time) : null;
      const startMin = start.h * 60 + start.m;
      let endMin = next ? next.h * 60 + next.m : startMin + 90;
      if (endMin <= startMin) endMin = startMin + 60;
      endMin = Math.min(endMin, startMin + 180, 23 * 60 + 59);
      const fmt = (mins: number) => `${ymd}T${pad(Math.floor(mins / 60))}${pad(mins % 60)}00`;
      const desc = [s.why, s.localTip ? `Local tip: ${s.localTip}` : "", s.place?.mapsUrl ?? "", tripUrl ?? ""].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${ymd}-${di}-${si}-${Math.abs(hash(s.name + it.title))}@pylos`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${fmt(startMin)}`,
        `DTEND:${fmt(endMin)}`,
        fold(`SUMMARY:${icsEscape(s.name)}`),
        fold(`LOCATION:${icsEscape(s.place?.address ?? `${s.name}, ${s.neighborhood ? s.neighborhood + ", " : ""}${city}`)}`),
        fold(`DESCRIPTION:${icsEscape(desc)}`),
        "END:VEVENT",
      );
    });
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
