import { createHash } from "node:crypto";
import {
  DESTINATIONS,
  DESTINATION_BY_KEY,
  TripRequestSchema,
  cityKey,
  countryName,
  inSeason,
  publicItinerary,
  sampleRequest,
  trendScore,
  type BrowseDestination,
  type Destination,
  type ForYouPick,
  type Itinerary,
} from "@travel/core";
import { z } from "zod";
import type { Ctx } from "./auth";
import { callTool } from "./claude";
import { myPlaces } from "./community";
import { HttpError } from "./http";
import { loadSources, planItinerary } from "./pipeline";
import { supabaseAdmin } from "./supabase/server";

/** The trip city keys that count toward a destination ("the cyclades", "cyclades"). */
const matchKeys = (d: Destination) => new Set([cityKey(d.name), d.key.replace(/-/g, " "), cityKey(d.name.replace(/^the\s+/i, ""))]);

const missingTable = (e: { code?: string } | null) => !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");

/** Activity on Pylos per destination: trips built in the last 30 days, public trips and their likes. */
async function activity(): Promise<Map<string, { recent: number; publicTrips: number; likes: number }>> {
  const out = new Map<string, { recent: number; publicTrips: number; likes: number }>();
  const admin = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [recent, pub] = await Promise.all([
    admin.from("trips").select("city_key").gte("created_at", since).limit(5000),
    admin.from("trips").select("city_key, likes_count").eq("visibility", "public").limit(5000),
  ]);
  if (recent.error || pub.error) {
    if (!missingTable(recent.error) && !missingTable(pub.error)) console.error("browse activity failed", recent.error?.message ?? pub.error?.message);
    return out;
  }
  const keyOf = new Map<string, string>();
  for (const d of DESTINATIONS) for (const k of matchKeys(d)) keyOf.set(k, d.key);
  const bump = (cityKeyValue: string | null, f: (a: { recent: number; publicTrips: number; likes: number }) => void) => {
    const k = cityKeyValue ? keyOf.get(cityKeyValue) : undefined;
    if (!k) return;
    const a = out.get(k) ?? { recent: 0, publicTrips: 0, likes: 0 };
    f(a);
    out.set(k, a);
  };
  for (const r of recent.data ?? []) bump(r.city_key as string | null, (a) => a.recent++);
  for (const r of pub.data ?? []) bump(r.city_key as string | null, (a) => { a.publicTrips++; a.likes += (r.likes_count as number) ?? 0; });
  return out;
}

/** Every featured destination with its trend score for this month, hottest first. */
export async function listBrowse(now = new Date()): Promise<{ month: number; destinations: BrowseDestination[] }> {
  const month = now.getUTCMonth() + 1;
  const act = await activity();
  const destinations = DESTINATIONS.map((d) => {
    const a = act.get(d.key) ?? { recent: 0, publicTrips: 0, likes: 0 };
    return { ...d, score: trendScore(d, month, a), publicTrips: a.publicTrips, inSeason: inSeason(d, month) };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { month, destinations };
}

// ---------------------------------------------------------------------------
// Sample itineraries: planned once per destination, cached, shown to everyone
// ---------------------------------------------------------------------------
export type SampleState = { status: "ready"; itinerary: Itinerary } | { status: "pending" | "generating" | "failed" | "unavailable" };

export async function readSample(key: string): Promise<SampleState> {
  const { data, error } = await supabaseAdmin().from("destination_samples").select("status, itinerary").eq("key", key).maybeSingle();
  if (error) {
    if (missingTable(error)) return { status: "unavailable" };
    console.error("sample read failed", error.message);
    return { status: "failed" };
  }
  if (data?.status === "ready" && data.itinerary) return { status: "ready", itinerary: data.itinerary as Itinerary };
  return { status: (data?.status as "pending" | "generating" | "failed") ?? "pending" };
}

const STALE_MS = 150_000;
const RETRY_FAILED_MS = 5 * 60_000;

/**
 * Make sure a destination has a sample itinerary. Only one request plans it; others see
 * "generating" and poll. Featured destinations only, so anonymous visitors can't run up costs.
 */
export async function ensureSample(key: string): Promise<SampleState> {
  const d = DESTINATION_BY_KEY[key];
  if (!d) throw new HttpError(404, "We don't have that destination.");
  const admin = supabaseAdmin();
  const { data: row, error } = await admin.from("destination_samples").select("status, itinerary, started_at, updated_at").eq("key", key).maybeSingle();
  if (error) {
    if (missingTable(error)) return { status: "unavailable" };
    throw error;
  }
  if (row?.status === "ready" && row.itinerary) return { status: "ready", itinerary: row.itinerary as Itinerary };
  const now = Date.now();
  if (row?.status === "generating" && now - new Date(row.started_at as string).getTime() < STALE_MS) return { status: "generating" };
  if (row?.status === "failed" && now - new Date(row.updated_at as string).getTime() < RETRY_FAILED_MS) return { status: "failed" };

  // Take the job: insert, or update only if nobody else took it since we looked.
  const startedAt = new Date().toISOString();
  if (!row) {
    const { error: insErr } = await admin.from("destination_samples").insert({ key, status: "generating", started_at: startedAt });
    if (insErr) return { status: "generating" }; // someone else inserted first
  } else {
    const { data: took } = await admin
      .from("destination_samples")
      .update({ status: "generating", started_at: startedAt, error: null })
      .eq("key", key)
      .eq("status", row.status as string)
      .select("key");
    if (!took?.length) return { status: "generating" };
  }

  try {
    const itinerary = await planSample(d);
    await admin.from("destination_samples").update({ status: "ready", itinerary, error: null }).eq("key", key);
    return { status: "ready", itinerary };
  } catch (e) {
    console.error("sample failed", key, e);
    await admin.from("destination_samples").update({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 300) }).eq("key", key);
    return { status: "failed" };
  }
}

async function planSample(d: Destination): Promise<Itinerary> {
  const ctx: Ctx = { user: null, db: supabaseAdmin(), role: "traveler" };
  const { eff, lists } = await loadSources(ctx);
  const req = TripRequestSchema.parse(sampleRequest(d));
  const t0 = Date.now();
  const { itin } = await planItinerary(req, { eff, lists, history: "" });
  console.log(`[sample] ${d.key} ${req.mode} ${req.days}d in ${Date.now() - t0}ms`);
  return publicItinerary(itin);
}

// ---------------------------------------------------------------------------
// For you: destinations picked from the places someone has logged
// ---------------------------------------------------------------------------
const PICKS_TOOL = {
  name: "submit_picks",
  description: "Submit the destinations this traveler should consider next.",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "The destination key from the list." },
            why: { type: "string", description: "Why, addressed to them, linked to what they loved (under 16 words)." },
          },
          required: ["key", "why"],
        },
      },
    },
    required: ["picks"],
  },
} as const;

export interface ForYouResult {
  picks: ForYouPick[];
  /** How many places they've logged, when it's too few to predict from. */
  placesLogged: number;
  needMore: boolean;
}

const MIN_PLACES = 2;

export async function forYou(ctx: Ctx): Promise<ForYouResult> {
  if (!ctx.user) return { picks: [], placesLogged: 0, needMore: true };
  const places = await myPlaces(ctx).catch(() => []);
  if (places.length < MIN_PLACES) return { picks: [], placesLogged: places.length, needMore: true };

  const hash = createHash("sha1")
    .update(JSON.stringify(places.map((p) => [p.city, p.countryCode, p.rating, p.highlights]).sort()))
    .digest("hex");
  const admin = supabaseAdmin();
  const cached = await admin.from("user_recs").select("places_hash, picks, created_at").eq("user_id", ctx.user.id).maybeSingle();
  if (!cached.error && cached.data && cached.data.places_hash === hash && Date.now() - new Date(cached.data.created_at as string).getTime() < 14 * 86_400_000) {
    return { picks: cached.data.picks as ForYouPick[], placesLogged: places.length, needMore: false };
  }

  const been = new Set(places.map((p) => cityKey(p.city)));
  const beenCountries = new Set(places.map((p) => p.countryCode.toUpperCase()));
  const month = new Date().getUTCMonth() + 1;
  const options = DESTINATIONS.filter((d) => !been.has(cityKey(d.name)));
  const prompt = `PLACES THIS TRAVELER HAS BEEN (best rated first)
${places
  .slice()
  .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  .slice(0, 25)
  .map((p) => `- ${p.city}, ${countryName(p.countryCode)}${p.year ? ` (${p.year})` : ""}${p.rating ? `, rated ${p.rating}/5` : ""}${p.highlights ? `: loved ${p.highlights.slice(0, 140)}` : ""}`)
  .join("\n")}

DESTINATIONS TO CHOOSE FROM (key · name · what it's about · best months)
${options.map((d) => `- ${d.key} · ${d.name}, ${d.country} · ${d.tags.join(", ")} · ${d.blurb} · months ${d.bestMonths.join(",")}`).join("\n")}

TASK
Pick the 4 destinations from the list this traveler is most likely to love next, judging by what they rated highly and what they loved.
- Prefer variety, and places in season around month ${month}. ${beenCountries.size ? "A new country is a plus but not required." : ""}
- "why" speaks to them directly and names the connection, e.g. "You loved Lisbon's tascas; Cádiz is the same, by the sea."
Call submit_picks.`;
  const { input } = await callTool(prompt, PICKS_TOOL, 1200, { fast: true });
  const parsed = z
    .object({ picks: z.array(z.object({ key: z.string(), why: z.string().transform((v) => v.slice(0, 160)) })) })
    .safeParse(input);
  const picks = parsed.success
    ? parsed.data.picks.filter((p, i, a) => DESTINATION_BY_KEY[p.key] && !been.has(cityKey(DESTINATION_BY_KEY[p.key]!.name)) && a.findIndex((x) => x.key === p.key) === i).slice(0, 4)
    : [];
  if (picks.length) {
    const { error } = await admin.from("user_recs").upsert({ user_id: ctx.user.id, places_hash: hash, picks, created_at: new Date().toISOString() });
    if (error && !missingTable(error)) console.error("save recs failed", error.message);
  }
  return { picks, placesLogged: places.length, needMore: false };
}
