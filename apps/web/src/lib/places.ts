import type { Candidate, CandidateCategory, PlaceVerification } from "@travel/core";
import { env } from "./env";
import { supabaseAdmin } from "./supabase/server";

// Google Places API (New): https://developers.google.com/maps/documentation/places/web-service/text-search
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.types",
  "places.shortFormattedAddress",
].join(",");

const CACHE_DAYS = 14;

interface GPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude: number; longitude: number };
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  types?: string[];
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export const placesEnabled = () => !!env.placesKey();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const db = supabaseAdmin();
  const { data } = await db.from("places_cache").select("data, fetched_at").eq("key", key).maybeSingle();
  if (data && Date.now() - new Date(data.fetched_at).getTime() < CACHE_DAYS * 864e5) return data.data as T;
  const fresh = await load();
  await db.from("places_cache").upsert({ key, data: fresh as object, fetched_at: new Date().toISOString() });
  return fresh;
}

async function searchText(textQuery: string, maxResultCount: number): Promise<GPlace[]> {
  if (!placesEnabled()) return [];
  const key = `search:${maxResultCount}:${textQuery.toLowerCase()}`;
  return cached(key, async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.placesKey(),
        "X-Goog-FieldMask": FIELDS,
      },
      body: JSON.stringify({ textQuery, maxResultCount, languageCode: "en" }),
    });
    if (!res.ok) {
      console.error("Places search failed", res.status, await res.text().catch(() => ""));
      return [];
    }
    const body = (await res.json()) as { places?: GPlace[] };
    return body.places ?? [];
  });
}

const neighborhoodOf = (p: GPlace) => p.shortFormattedAddress?.split(",").slice(-1)[0]?.trim() || null;

/** Candidates from a Places search. Google results are tagged as the "reviews" source. */
export async function placesCandidates(query: string, category: CandidateCategory, limit = 10): Promise<Candidate[]> {
  const places = await searchText(query, limit);
  return places
    .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY" && p.displayName?.text)
    .map((p) => ({
      id: `gp_${p.id}`,
      origin: "google" as const,
      name: p.displayName!.text!,
      neighborhood: neighborhoodOf(p),
      category,
      source: "reviews" as const,
      placeId: p.id,
      rating: p.rating ?? null,
      ratingCount: p.userRatingCount ?? null,
      priceLevel: p.priceLevel ? (PRICE_LEVELS[p.priceLevel] ?? null) : null,
      tags: p.types?.slice(0, 5) ?? [],
    }));
}

const toVerification = (p: GPlace): PlaceVerification => ({
  placeId: p.id,
  mapsUrl: p.googleMapsUri,
  address: p.formattedAddress,
  lat: p.location?.latitude,
  lng: p.location?.longitude,
  hours: p.regularOpeningHours?.weekdayDescriptions,
  status: p.businessStatus,
});

const STOP_WORDS = new Set(["the", "and", "hotel", "restaurant", "cafe", "bar", "de", "da", "do", "dos", "das", "la", "le", "el", "los", "las"]);
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
/** True when the two names share a meaningful word (accent- and case-insensitive). */
export function namesMatch(a: string, b: string): boolean {
  const wa = words(a);
  const wb = new Set(words(b));
  if (!wa.length || !wb.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return wa.some((w) => wb.has(w));
}

/** Look up one named place. Returns null when it can't be found. */
export async function verifyPlace(name: string, neighborhood: string, city: string): Promise<PlaceVerification | null> {
  if (!placesEnabled()) return null;
  const results = await searchText(`${name}, ${neighborhood ? neighborhood + ", " : ""}${city}`, 1);
  const p = results[0];
  if (!p) return null;
  if (!namesMatch(name, p.displayName?.text ?? "")) return null; // a different place came back
  return toVerification(p);
}

/** Details for a known place id (cached). */
export async function placeById(placeId: string): Promise<PlaceVerification | null> {
  if (!placesEnabled()) return null;
  return cached(`place:${placeId}`, async () => {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": env.placesKey(),
        "X-Goog-FieldMask": FIELDS.replaceAll("places.", ""),
      },
    });
    if (!res.ok) return null;
    return toVerification((await res.json()) as GPlace);
  });
}
