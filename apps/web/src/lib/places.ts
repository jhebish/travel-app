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
  // Same price tier as the fields above: photos cost nothing extra to list.
  "places.photos",
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
  photos?: { name: string; widthPx?: number; heightPx?: number; authorAttributions?: { displayName?: string; uri?: string }[] }[];
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/**
 * After an error that will keep happening (key, API switched off, quota, Google down), Places is
 * paused for a few minutes. Trips then build from unverified picks, as with no key, instead of
 * every lookup failing and every place being dropped.
 */
const PAUSE_MS = 5 * 60_000;
let pausedUntil = 0;
const pauseOn = (status: number, body = "") => {
  if (status === 401 || status === 403 || status === 429 || status >= 500 || /api key/i.test(body)) pausedUntil = Date.now() + PAUSE_MS;
};

export const placesEnabled = () => !!env.placesKey() && Date.now() >= pausedUntil;

/** Cached lookups. `load` throws on a failed request, so failures are never cached. */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const db = supabaseAdmin();
  const { data } = await db.from("places_cache").select("data, fetched_at").eq("key", key).maybeSingle();
  if (data && Date.now() - new Date(data.fetched_at).getTime() < CACHE_DAYS * 864e5) return data.data as T;
  const fresh = await load();
  await db.from("places_cache").upsert({ key, data: fresh as object, fetched_at: new Date().toISOString() });
  return fresh;
}

/** A failed Places request: Google couldn't answer, which is not the same as "no such place". */
export class PlacesError extends Error {}

async function failed(res: Response, what: string): Promise<never> {
  const body = (await res.text().catch(() => "")).slice(0, 200);
  console.error(`Places ${what} failed`, res.status, body);
  pauseOn(res.status, body);
  throw new PlacesError(`${what} ${res.status}`);
}

/** Text search. Throws PlacesError when the request fails. */
async function searchText(textQuery: string, maxResultCount: number): Promise<GPlace[]> {
  if (!placesEnabled()) return [];
  const key = `search2:${maxResultCount}:${textQuery.toLowerCase()}`;
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
    if (!res.ok) return failed(res, "search");
    const body = (await res.json()) as { places?: GPlace[] };
    return body.places ?? [];
  });
}

const neighborhoodOf = (p: GPlace) => p.shortFormattedAddress?.split(",").slice(-1)[0]?.trim() || null;

/** Candidates from a Places search. Google results are tagged as the "reviews" source. */
export async function placesCandidates(query: string, category: CandidateCategory, limit = 10): Promise<Candidate[]> {
  const places = await searchText(query, limit).catch((e) => {
    if (e instanceof PlacesError) return [] as GPlace[]; // candidates are optional
    throw e;
  });
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
      verification: toVerification(p),
      rating: p.rating ?? null,
      ratingCount: p.userRatingCount ?? null,
      priceLevel: p.priceLevel ? (PRICE_LEVELS[p.priceLevel] ?? null) : null,
      tags: p.types?.slice(0, 5) ?? [],
    }));
}

const https = (u?: string) => (u ? (u.startsWith("//") ? `https:${u}` : u.startsWith("https://") ? u : undefined) : undefined);

function toVerification(p: GPlace): PlaceVerification {
  return {
  placeId: p.id,
  photos: p.photos?.slice(0, 3).map((ph) => ({
    name: ph.name,
    w: ph.widthPx || undefined,
    h: ph.heightPx || undefined,
    by: ph.authorAttributions?.[0]?.displayName?.slice(0, 120),
    byUrl: https(ph.authorAttributions?.[0]?.uri),
  })),
  mapsUrl: https(p.googleMapsUri),
  address: p.formattedAddress,
  lat: p.location?.latitude,
  lng: p.location?.longitude,
  hours: p.regularOpeningHours?.weekdayDescriptions,
  status: p.businessStatus,
  };
}

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

/**
 * Look up one named place. Returns null when Google has no such place, and throws PlacesError
 * when Google couldn't be asked: callers keep the pick unverified rather than dropping it.
 */
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
  return cached(`place2:${placeId}`, async () => {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": env.placesKey(),
        "X-Goog-FieldMask": FIELDS.replaceAll("places.", ""),
      },
    });
    if (res.status === 404) return null; // gone: worth remembering
    if (!res.ok) return failed(res, "details");
    return toVerification((await res.json()) as GPlace);
  }).catch((e) => {
    if (e instanceof PlacesError) return null;
    throw e;
  });
}

/** A fresh photo for a place (photo names expire; ids don't). */
export async function freshPhotoName(placeId: string): Promise<string | null> {
  if (!placesEnabled() || !/^[A-Za-z0-9_-]+$/.test(placeId)) return null;
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { "X-Goog-Api-Key": env.placesKey(), "X-Goog-FieldMask": "photos" },
    cache: "no-store",
  });
  if (!res.ok) {
    pauseOn(res.status);
    return null;
  }
  const body = (await res.json()) as { photos?: { name: string }[] };
  return body.photos?.[0]?.name ?? null;
}

/** A short-lived image URL for a photo name at a given width (null if the name expired). */
export async function photoUrl(name: string, width: number): Promise<string | null> {
  if (!placesEnabled()) return null;
  const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&skipHttpRedirect=true`, {
    headers: { "X-Goog-Api-Key": env.placesKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    pauseOn(res.status); // an expired photo name is a 400/404 and doesn't pause
    return null;
  }
  const body = (await res.json()) as { photoUri?: string };
  return body.photoUri?.startsWith("https://") ? body.photoUri : null;
}
