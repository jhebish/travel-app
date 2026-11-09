/**
 * Guessing where someone wants to go as they type it: instant matches from what's already known
 * (Pylos destinations, their For you picks, the places they've been, every country), merged with
 * the places a map search finds. Used by the destination box on the site and in the app.
 */
import { COUNTRIES, countryName } from "./countries";
import { DESTINATIONS } from "./destinations";

export type SuggestKind = "city" | "region" | "country";

export interface PlaceSuggestion {
  /** What goes in the destination box: "Lisbon, Portugal", "Tuscany, Italy", "Japan". */
  label: string;
  /** First line: "Lisbon". */
  name: string;
  /** Second line: "Portugal", "Several stops · Italy". */
  sub: string;
  kind: SuggestKind;
  /** Why it's near the top: one of their picks, somewhere they've been, or a place Pylos features. */
  reason?: "for-you" | "been" | "featured";
  /** The destination's key when it's one Pylos features. */
  key?: string;
}

export const REASON_LABELS: Record<NonNullable<PlaceSuggestion["reason"]>, string> = {
  "for-you": "For you",
  been: "You've been",
  featured: "On Pylos",
};

/** Lowercase, no accents or punctuation: "São Paulo" and "sao paulo" match. */
export const foldPlace = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** 3 when the name starts with what's typed, 2 when one of its words does, 0 otherwise. */
function match(q: string, name: string): number {
  const n = foldPlace(name);
  if (!q || !n) return 0;
  if (n.startsWith(q)) return 3;
  return n.split(" ").some((w) => w.startsWith(q)) ? 2 : 0;
}

/**
 * Instant suggestions for what's typed, best first, without a network call. The kind of trip
 * decides what comes first: cities for one place, countries and regions for several stops.
 */
export function localSuggestions(
  query: string,
  o: { mode: "single" | "multi"; forYou?: string[]; been?: { city: string; countryCode: string }[]; max?: number },
): PlaceSuggestion[] {
  const q = foldPlace(query);
  if (!q) return [];
  const multi = o.mode === "multi";
  const forYou = new Set(o.forYou ?? []);
  const out: (PlaceSuggestion & { rank: number })[] = [];

  for (const d of DESTINATIONS) {
    // A Pylos place matches on its own name, or a little on its country's ("port" → Lisbon, Porto).
    const s = Math.max(match(q, d.name), match(q, d.country) ? 1 : 0);
    if (!s) continue;
    const region = d.kind === "region";
    out.push({
      label: region ? d.name : `${d.name}, ${d.country}`,
      name: d.name,
      sub: region ? `Several stops · ${d.country}` : d.country,
      kind: region ? "region" : "city",
      reason: forYou.has(d.key) ? "for-you" : "featured",
      key: d.key,
      rank: s * 10 + (forYou.has(d.key) ? 5 : 0) + (region === multi ? 2 : 0),
    });
  }
  for (const b of o.been ?? []) {
    const s = match(q, b.city);
    if (!s) continue;
    const country = countryName(b.countryCode);
    out.push({ label: `${b.city}, ${country}`, name: b.city, sub: country, kind: "city", reason: "been", rank: s * 10 + 3 + (multi ? 0 : 1) });
  }
  for (const [, name] of COUNTRIES) {
    const s = match(q, name);
    if (!s) continue;
    out.push({ label: name, name, sub: "Country · several stops", kind: "country", rank: s * 10 + (multi ? 4 : -2) });
  }
  return dedupeSuggestions(out.sort((a, b) => b.rank - a.rank || a.name.length - b.name.length))
    .slice(0, o.max ?? 6)
    .map(({ rank: _rank, ...s }) => s as PlaceSuggestion);
}

/** One of each place: the first one listed wins ("Lisbon, Portugal" from Pylos over the map's). */
export function dedupeSuggestions<T extends PlaceSuggestion>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = foldPlace(s.label);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The instant ones first, then the map search's, up to `max`. */
export function mergeSuggestions(local: PlaceSuggestion[], remote: PlaceSuggestion[], max = 6): PlaceSuggestion[] {
  return dedupeSuggestions([...local, ...remote]).slice(0, max);
}

/** The map search's place types as a kind (Google Places: country, locality, administrative areas…). */
export function suggestKind(types: string[] | undefined): SuggestKind {
  const t = new Set(types ?? []);
  if (t.has("country")) return "country";
  if (["locality", "postal_town", "administrative_area_level_3", "sublocality", "neighborhood", "colloquial_area"].some((x) => t.has(x))) return "city";
  return "region";
}
