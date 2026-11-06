import type { TasteSignal } from "../taste";
import { canonicalCity } from "./cities";
import { fold, nameKey } from "./text";

/**
 * Merge duplicates: first signals with the same source and ref (the same account read twice),
 * then the same place across sources by name and city, ignoring accents and case ("Café A
 * Brasileira, Lisbon" tagged on Facebook and "Cafe a Brasileira, Lisboa" from a calendar). The
 * richer record is kept (rating, then note, then date…) and its empty fields are filled from the
 * other. Order follows first appearance. Inputs are not modified.
 */
export function dedupeSignals(signals: TasteSignal[]): TasteSignal[] {
  return collapse(collapse(signals, refKey), placeKey);
}

export const refKey = (s: TasteSignal) => `${s.source}\u0000${s.ref}`;

function placeKey(s: TasteSignal): string {
  const where = s.city
    ? fold(canonicalCity(s.city))
    : s.countryCode
      ? s.countryCode.toUpperCase()
      : s.lat != null && s.lng != null
        ? `${s.lat.toFixed(2)},${s.lng.toFixed(2)}`
        : "";
  return `${s.kind === "city" ? "city" : "place"}\u0000${nameKey(s.name)}\u0000${where}`;
}

/** Merge signals that share a key, keeping the first one's position. */
export function collapse(signals: TasteSignal[], keyOf: (s: TasteSignal) => string): TasteSignal[] {
  const kept = new Map<string, TasteSignal>();
  for (const s of signals) {
    const k = keyOf(s);
    const prev = kept.get(k);
    kept.set(k, prev ? mergeSignals(prev, s) : s);
  }
  return [...kept.values()];
}

const richness = (s: TasteSignal) =>
  (s.rating != null ? 4 : 0) +
  (s.note ? 2 : 0) +
  (s.date ? 1 : 0) +
  (s.liked != null ? 1 : 0) +
  (s.city ? 0.5 : 0) +
  (s.lat != null && s.lng != null ? 0.5 : 0) +
  (s.countryCode ? 0.25 : 0) +
  (s.url ? 0.25 : 0);

/** The richer of two records for the same place, with gaps filled from the other. Ties keep `a`. */
function mergeSignals(a: TasteSignal, b: TasteSignal): TasteSignal {
  const [keep, other] = richness(b) > richness(a) ? [b, a] : [a, b];
  const out: TasteSignal = { ...keep };
  for (const f of ["city", "countryCode", "date", "rating", "liked", "note", "url"] as const) {
    if (out[f] == null && other[f] != null) (out as unknown as Record<string, unknown>)[f] = other[f];
  }
  if ((out.lat == null || out.lng == null) && other.lat != null && other.lng != null) {
    out.lat = other.lat;
    out.lng = other.lng;
  }
  return out;
}
