import {
  DAY_TOOL,
  STOP_TOOL,
  StopSchema,
  buildDayPrompt,
  buildSwapPrompt,
  HOTELS_TOOL,
  HotelSchema,
  ItinerarySchema,
  OUTLINE_TOOL,
  OutlineSchema,
  blendWeights,
  buildHotelPrompt,
  buildHotelPromptForAreas,
  buildOutlinePrompt,
  buildPlanDayPrompt,
  isSourceId,
  placesQueries,
  selectCandidates,
  stayLabel,
  type BuildEvent,
  type Candidate,
  type EffectiveSources,
  type Outline,
  type Hotel,
  type Itinerary,
  type StayPrefs,
  type Stop,
  type TripRequest,
  type Weights,
  salvage,
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
export type Emit = (e: BuildEvent) => void;

const DayResultSchema = z.object({
  theme: z.preprocess((v) => (typeof v === "string" ? v.slice(0, 160) : undefined), z.string().optional()),
  stops: salvage(StopSchema, 1, 8),
});

/** Run a model step, retrying once if the answer doesn't validate. */
async function step<T>(
  label: string,
  run: (attempt: number) => Promise<{ input: unknown; model: string }>,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<{ data: T; model: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { input, model } = await run(attempt);
      const parsed = schema.safeParse(input);
      if (parsed.success) return { data: parsed.data, model };
      console.error(`${label} failed validation (attempt ${attempt + 1})`, JSON.stringify(parsed.error.issues.slice(0, 4)), JSON.stringify(input).slice(0, 600));
    } catch (e) {
      // A bad or cut-off answer gets one more try; outages and auth errors don't.
      if (!(e instanceof HttpError) || !["bad_output", "too_long"].includes(e.code ?? "")) throw e;
      console.error(`${label} attempt ${attempt + 1}: ${e.code}`);
      lastErr = e;
    }
  }
  if (lastErr instanceof HttpError && lastErr.code === "too_long") throw lastErr;
  throw new HttpError(502, "The plan came back incomplete. Try again.", "bad_output");
}

/** Remove a place that appears on more than one day (days are planned in parallel). */
function dedupeAcrossDays(itin: Itinerary) {
  const seen = new Set<string>();
  const key = (s: Stop) => (s.candidateId || s.name).toLowerCase().replace(/[^a-z0-9]/g, "");
  itin.days = itin.days.map((d) => {
    const stops = d.stops.filter((s) => {
      const k = key(s);
      if (seen.has(k) && d.stops.length > 2) return false;
      seen.add(k);
      return true;
    });
    return { ...d, stops };
  });
}

/**
 * Build a trip. Fast path: one short outline call (title, notes, an area per day), then every
 * day and the hotels are planned at the same time. Progress is reported through `emit`.
 */
export async function generateTrip(ctx: Ctx, req: TripRequest, opts: { ip: string; tripsPerHour: number }, emit: Emit = () => {}) {
  const t0 = Date.now();
  const progress = (pct: number, label: string) => emit({ type: "progress", pct, label });
  progress(3, "Reading your request");
  await checkRateLimit(ctx, opts.tripsPerHour);
  const { eff, lists } = await loadSources(ctx);

  progress(8, "Gathering local picks");
  const cands = selectCandidates(await gatherCandidates(req), eff, req);

  progress(15, `Sketching your ${req.days}-day outline`);
  const { data: outline, model } = await step(
    "outline",
    (attempt) => callTool(buildOutlinePrompt(req, eff, lists, cands), OUTLINE_TOOL, attempt ? 5000 : 3000),
    OutlineSchema,
  );
  const o: Outline = { ...outline, days: outline.days.slice(0, req.days) };
  emit({ type: "outline", title: o.title, days: o.days.map((d) => ({ label: d.label, theme: d.theme })), hotels: req.stay.on });

  // Parallel: every day, plus hotels.
  const jobs = o.days.length + (req.stay.on ? 1 : 0);
  let finished = 0;
  const tick = (label: string) => {
    finished++;
    progress(30 + Math.round((finished / jobs) * 55), label);
  };
  progress(30, "Planning every day at once");

  const dayJobs = o.days.map(async (d, i) => {
    const { data } = await step(
      `day ${i + 1}`,
      (attempt) => callTool(buildPlanDayPrompt(req, eff, lists, o, i, cands), DAY_TOOL, attempt ? 6000 : 4000, { fast: attempt === 0 }),
      DayResultSchema,
    );
    emit({ type: "day", index: i });
    tick(`${d.label} planned`);
    return { label: d.label || `Day ${i + 1}`, theme: data.theme || d.theme, stops: data.stops };
  });
  const hotelJob = req.stay.on
    ? (async () => {
        const stayCands = cands.filter((c) => c.category === "stay");
        const areas = o.days.map((d) => d.area).filter(Boolean);
        try {
          const { data } = await step(
            "hotels",
            (attempt) => callTool(buildHotelPromptForAreas(req, eff, lists, areas, stayCands), HOTELS_TOOL, 3000, { fast: attempt === 0 }),
            z.object({ hotels: salvage(HotelSchema, 1, 5) }),
          );
          return data.hotels.slice(0, 3);
        } catch (e) {
          console.error("hotels step failed; trip continues without hotels", e);
          return [];
        } finally {
          emit({ type: "hotels" });
          tick("Places to stay picked");
        }
      })()
    : Promise.resolve([] as Hotel[]);

  const [days, hotels] = await Promise.all([Promise.all(dayJobs), hotelJob]);
  const itin: Itinerary = ItinerarySchema.parse({ title: o.title, summary: o.summary, notes: o.notes, days, hotels, replaced: [] });
  if (itin.hotels.length) itin.stayLabel = stayLabel(req.stay);
  dedupeAcrossDays(itin);

  console.log(`[build] model calls done ${Date.now() - t0}ms`);
  progress(88, placesEnabled() ? "Checking every place on the map" : "Finishing touches");
  await groundItinerary(itin, cands, req.destination);
  await attachLiveRates(itin.hotels, req.startDate, req.days, adultsFor(req.party), opts.ip);

  progress(96, "Saving your trip");
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
  console.log(`[build] total ${Date.now() - t0}ms`);
  progress(100, "Done");
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

// ---------------------------------------------------------------------------
// Editing: swap one stop, rebuild one day, lock a stop
// ---------------------------------------------------------------------------
const sortByTime = (stops: Stop[]) =>
  [...stops].sort((a, b) => (a.time || "").localeCompare(b.time || "", undefined, { numeric: true }));

/** Move votes for stops being replaced into itinerary.replaced so the training signal survives. */
function retireVotes(row: TripRow, keys: string[], itin: Itinerary) {
  const votes = { ...(row.votes ?? {}) };
  const replaced = [...(itin.replaced ?? [])];
  for (const k of keys) {
    const v = votes[k];
    if (!v) continue;
    const [d, i] = k.split("-").map(Number) as [number, number];
    const stop = row.itinerary.days[d]?.stops[i];
    if (stop) replaced.push({ source: stop.source, vote: v });
    delete votes[k];
  }
  return { votes, replaced: replaced.slice(-200) };
}

async function saveEdit(ctx: Ctx, row: TripRow, itinerary: Itinerary, votes: TripRow["votes"]) {
  const { data, error } = await ctx.db.from("trips").update({ itinerary, votes }).eq("id", row.id).select("*").single();
  if (error || !data) throw new HttpError(500, "Your change was made but couldn't be saved. Try again.");
  await syncFeedback(data as TripRow);
  return toTrip(data as TripRow);
}

function editContext(row: TripRow) {
  const req: TripRequest = row.request;
  const eff: EffectiveSources = { weights: row.weights, blocked: (row.blocked ?? []).filter(isSourceId), custom: row.custom_mix };
  const inTrip = new Set(
    [...row.itinerary.days.flatMap((d) => d.stops), ...(row.itinerary.hotels ?? [])].map((p) => p.name.toLowerCase()),
  );
  return { req, eff, inTrip };
}

export async function swapStop(ctx: Ctx, row: TripRow, day: number, index: number, hint: string) {
  const old = row.itinerary.days[day]?.stops[index];
  if (!old) throw new HttpError(404, "That stop isn't in this trip anymore. Reload and try again.");
  const { req, eff, inTrip } = editContext(row);
  const { lists } = await loadSources(ctx);
  const cands = selectCandidates(await gatherCandidates(req), eff, req).filter(
    (c) => c.category !== "stay" && !inTrip.has(c.name.toLowerCase()),
  );
  const { input } = await callTool(buildSwapPrompt(req, eff, lists, row.itinerary, day, index, hint, cands), STOP_TOOL, 2000, { fast: true });
  const parsed = z.object({ stop: StopSchema }).safeParse(input);
  if (!parsed.success) throw new HttpError(502, "The replacement came back incomplete. Try again.", "bad_output");
  const stop = parsed.data.stop;
  if (inTrip.has(stop.name.toLowerCase())) throw new HttpError(502, "The planner suggested a place already in your trip. Try again.", "duplicate");
  const drop = await ground([stop], cands, req.destination);
  if (drop.has(stop)) throw new HttpError(502, "We couldn't verify the replacement. Try again.", "unverified");

  const itinerary: Itinerary = structuredClone(row.itinerary);
  const { votes, replaced } = retireVotes(row, [`${day}-${index}`], itinerary);
  itinerary.replaced = replaced;
  itinerary.days[day]!.stops[index] = { ...stop, locked: false };
  return saveEdit(ctx, row, itinerary, votes);
}

export async function regenerateDay(ctx: Ctx, row: TripRow, day: number, hint: string) {
  const current = row.itinerary.days[day];
  if (!current) throw new HttpError(404, "That day isn't in this trip anymore. Reload and try again.");
  const { req, eff } = editContext(row);
  const { lists } = await loadSources(ctx);
  const otherDays = new Set(
    [...row.itinerary.days.flatMap((d, i) => (i === day ? [] : d.stops)), ...(row.itinerary.hotels ?? [])].map((p) => p.name.toLowerCase()),
  );
  const cands = selectCandidates(await gatherCandidates(req), eff, req).filter(
    (c) => c.category !== "stay" && !otherDays.has(c.name.toLowerCase()),
  );
  const { input } = await callTool(buildDayPrompt(req, eff, lists, row.itinerary, day, hint, cands), DAY_TOOL, 8000);
  const parsed = z.object({ theme: z.string().transform((v) => v.slice(0, 160)), stops: z.array(StopSchema).min(1).transform((a) => a.slice(0, 8)) }).safeParse(input);
  if (!parsed.success) throw new HttpError(502, "The new day came back incomplete. Try again.", "bad_output");

  // Locked stops are kept exactly, whatever the model returned.
  const locked = current.stops.filter((s) => s.locked);
  const lockedNames = new Set(locked.map((s) => s.name.toLowerCase()));
  const fresh = parsed.data.stops
    .filter((s) => !lockedNames.has(s.name.toLowerCase()) && !otherDays.has(s.name.toLowerCase()))
    .map((s) => ({ ...s, locked: false }));
  const drop = await ground(fresh, cands, req.destination);
  const stops = sortByTime([...locked, ...fresh.filter((s) => !drop.has(s))]);
  if (!stops.length) throw new HttpError(502, "We couldn't verify places for the new day. Try again.", "unverified");

  const itinerary: Itinerary = structuredClone(row.itinerary);
  // Votes on replaced stops are retired; locked stops keep theirs at their new positions.
  const replacedKeys = current.stops.map((s, i) => (s.locked ? null : `${day}-${i}`)).filter((k): k is string => !!k);
  const { votes: afterRetire, replaced } = retireVotes(row, replacedKeys, itinerary);
  const votes = Object.fromEntries(Object.entries(afterRetire).filter(([k]) => !k.startsWith(`${day}-`)));
  current.stops.forEach((s, i) => {
    const v = row.votes?.[`${day}-${i}`];
    if (s.locked && v) votes[`${day}-${stops.indexOf(s)}`] = v;
  });
  itinerary.replaced = replaced;
  itinerary.days[day] = { ...current, theme: parsed.data.theme || current.theme, stops };
  return saveEdit(ctx, row, itinerary, votes);
}

export async function setLocked(ctx: Ctx, row: TripRow, day: number, index: number, locked: boolean) {
  if (!row.itinerary.days[day]?.stops[index]) throw new HttpError(404, "That stop isn't in this trip anymore. Reload and try again.");
  const itinerary: Itinerary = structuredClone(row.itinerary);
  itinerary.days[day]!.stops[index]!.locked = locked;
  return saveEdit(ctx, row, itinerary, row.votes ?? {});
}
