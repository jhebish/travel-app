import {
  HOTELS_TOOL,
  HotelSchema,
  ITINERARY_TOOL,
  ItinerarySchema,
  blendWeights,
  buildHotelPrompt,
  buildTripPrompt,
  isSourceId,
  placesQueries,
  selectCandidates,
  stayLabel,
  type Candidate,
  type EffectiveSources,
  type Hotel,
  type Itinerary,
  type StayPrefs,
  type Stop,
  type TripRequest,
  type Weights,
} from "@travel/core";
import { z } from "zod";
import type { Ctx } from "./auth";
import { callTool } from "./claude";
import { syncFeedback } from "./feedback";
import { adultsFor, attachLiveRates } from "./hotels";
import { HttpError } from "./http";
import { placeById, placesCandidates, placesEnabled, verifyPlace } from "./places";
import { supabaseAdmin } from "./supabase/server";
import { toTrip, type TripRow } from "./trips";

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
export async function loadSources(ctx: Ctx) {
  const { data: cfg, error } = await ctx.db.from("app_config").select("*").eq("id", 1).single();
  if (error || !cfg) throw new HttpError(500, "App settings are missing. Run the database migration.");
  const appBlocked = ((cfg.blocked as string[]) ?? []).filter(isSourceId);
  let prefs = null;
  if (ctx.user) {
    const { data } = await ctx.db.from("user_prefs").select("*").eq("user_id", ctx.user.id).maybeSingle();
    if (data)
      prefs = {
        useCustom: !!data.use_custom,
        weights: (data.weights ?? {}) as Partial<Weights>,
        blocked: ((data.blocked as string[]) ?? []).filter(isSourceId),
      };
  }
  const eff = blendWeights({ weights: cfg.weights as Partial<Weights>, blocked: appBlocked }, prefs);
  const lists = { alwaysFeature: (cfg.always_feature as string) ?? "", neverRecommend: (cfg.never_recommend as string) ?? "" };
  return { eff, lists };
}

// ---------------------------------------------------------------------------
// Candidates: approved local picks first, then Places results
// ---------------------------------------------------------------------------
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

async function localPickCandidates(city: string, staysOnly: boolean): Promise<Candidate[]> {
  let q = supabaseAdmin()
    .from("local_picks")
    .select("*")
    .eq("status", "approved")
    .ilike("city", `%${likeEscape(city.split(",")[0]!.trim())}%`)
    .limit(200);
  if (staysOnly) q = q.eq("category", "stay");
  const { data, error } = await q;
  if (error) {
    console.error("local picks query failed", error.message);
    return [];
  }
  return (data ?? []).map((p) => ({
    id: `lp_${p.id}`,
    origin: "local_pick" as const,
    name: p.name,
    neighborhood: p.neighborhood,
    category: p.category,
    source: isSourceId(p.source) ? p.source : "locals",
    note: p.note,
    tags: p.tags ?? [],
    placeId: p.google_place_id,
    stayStyle: p.stay_style,
    priceBand: p.price_band,
    expediaPropertyId: p.expedia_property_id,
  }));
}

async function gatherCandidates(req: TripRequest, staysOnly = false): Promise<Candidate[]> {
  const queries = placesQueries(req).filter((q) => !staysOnly || q.category === "stay");
  const [picks, ...places] = await Promise.allSettled([
    localPickCandidates(req.destination, staysOnly),
    ...queries.map((q) => placesCandidates(q.query, q.category, 8)),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T[]> | undefined) => (r?.status === "fulfilled" ? r.value : []);
  return [...ok(picks), ...places.flatMap((p) => ok(p))];
}

// ---------------------------------------------------------------------------
// Grounding: correct each pick's source to its real origin and verify it exists
// ---------------------------------------------------------------------------
async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

type Pick = (Stop | Hotel) & { expediaPropertyId?: string | null };

async function ground(picks: Pick[], cands: Candidate[], city: string): Promise<Set<Pick>> {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const drop = new Set<Pick>();
  await pool(picks, 6, async (p) => {
    const cand = p.candidateId ? byId.get(p.candidateId) : undefined;
    if (cand) {
      p.origin = cand.origin;
      p.source = cand.source; // the candidate's real source wins over the model's label
      if (cand.category === "stay") p.expediaPropertyId = cand.expediaPropertyId ?? null;
    } else {
      p.candidateId = null;
      p.origin = "ai";
    }
    try {
      const v = cand?.placeId ? await placeById(cand.placeId) : await verifyPlace(p.name, p.neighborhood ?? "", city);
      if (v) {
        if (v.status === "CLOSED_PERMANENTLY") drop.add(p);
        else p.place = v;
      } else if (p.origin === "ai" && placesEnabled()) {
        drop.add(p); // the model named a place we can't find: leave it out
      }
    } catch (e) {
      console.error("verify failed", p.name, e);
    }
  });
  return drop;
}

async function groundItinerary(itin: Itinerary, cands: Candidate[], city: string) {
  const drop = await ground([...itin.days.flatMap((d) => d.stops), ...itin.hotels], cands, city);
  itin.days = itin.days
    .map((d) => ({ ...d, stops: d.stops.filter((s) => !drop.has(s)) }))
    .filter((d) => d.stops.length > 0);
  itin.hotels = itin.hotels.filter((h) => !drop.has(h));
  if (!itin.days.length) throw new HttpError(502, "We couldn't verify enough places for this trip. Try again or adjust the request.", "unverified");
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------
async function checkRateLimit(ctx: Ctx, limit: number) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await ctx.db
    .from("trips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user!.id)
    .gte("created_at", since);
  if ((count ?? 0) >= limit) throw new HttpError(429, "You've built a lot of trips this hour. Try again a little later.", "rate_limited");
}

// ---------------------------------------------------------------------------
// Public pipeline
// ---------------------------------------------------------------------------
export async function generateTrip(ctx: Ctx, req: TripRequest, opts: { ip: string; tripsPerHour: number }) {
  await checkRateLimit(ctx, opts.tripsPerHour);
  const { eff, lists } = await loadSources(ctx);
  const cands = selectCandidates(await gatherCandidates(req), eff, req);
  const { input, model } = await callTool(buildTripPrompt(req, eff, lists, cands), ITINERARY_TOOL);
  const parsed = ItinerarySchema.safeParse(input);
  if (!parsed.success) {
    console.error("itinerary failed validation", parsed.error.issues.slice(0, 5));
    throw new HttpError(502, "The plan came back incomplete. Try again.", "bad_output");
  }
  const itin = parsed.data;
  itin.hotels = req.stay.on ? itin.hotels.slice(0, 3) : [];
  if (itin.hotels.length) itin.stayLabel = stayLabel(req.stay);
  await groundItinerary(itin, cands, req.destination);
  await attachLiveRates(itin.hotels, req.startDate, req.days, adultsFor(req.party), opts.ip);

  const { data, error } = await ctx.db
    .from("trips")
    .insert({
      user_id: ctx.user!.id,
      destination: req.destination,
      title: itin.title,
      request: req,
      weights: eff.weights,
      blocked: eff.blocked,
      custom_mix: eff.custom,
      itinerary: itin,
      model,
    })
    .select("*")
    .single();
  if (error || !data) throw new HttpError(500, "Your trip was built but couldn't be saved. Try again.");
  return toTrip(data as TripRow);
}

export async function generateHotels(ctx: Ctx, row: TripRow, stay: StayPrefs, opts: { ip: string }) {
  const req: TripRequest = { ...row.request, stay: { ...stay, on: true } };
  const { lists } = await loadSources(ctx);
  const eff: EffectiveSources = { weights: row.weights, blocked: (row.blocked ?? []).filter(isSourceId), custom: row.custom_mix };
  const cands = selectCandidates(await gatherCandidates(req, true), eff, req);
  const { input } = await callTool(buildHotelPrompt(req, eff, lists, row.itinerary, cands), HOTELS_TOOL, 3000);
  const parsed = z.object({ hotels: z.array(HotelSchema).min(1) }).safeParse(input);
  if (!parsed.success) throw new HttpError(502, "Hotel picks came back incomplete. Try again.", "bad_output");
  const hotels = parsed.data.hotels.slice(0, 3);
  const drop = await ground(hotels, cands, req.destination);
  const kept = hotels.filter((h) => !drop.has(h));
  if (!kept.length) throw new HttpError(502, "We couldn't verify any hotels for this trip. Try a different style or price.", "unverified");
  await attachLiveRates(kept, req.startDate, req.days, adultsFor(req.party), opts.ip);

  const itinerary: Itinerary = { ...row.itinerary, hotels: kept, stayLabel: stayLabel(req.stay) };
  // Hotel votes refer to positions in the old list; clear them.
  const votes = Object.fromEntries(Object.entries(row.votes ?? {}).filter(([k]) => !k.startsWith("h-")));
  const { data, error } = await ctx.db
    .from("trips")
    .update({ itinerary, request: req, votes })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error || !data) throw new HttpError(500, "Hotels were found but couldn't be saved. Try again.");
  await syncFeedback(data as TripRow);
  return toTrip(data as TripRow);
}
