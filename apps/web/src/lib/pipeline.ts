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
  buildHotelPromptForAreas,
  buildOutlinePrompt,
  buildPlanDayPrompt,
  isSourceId,
  placesQueries,
  selectCandidates,
  stayLabel,
  isStayTier,
  stayTier,
  type StayScale,
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
  cityKey,
  countryName,
  historyForPrompt,
  type PastTrip,
  type Visibility,
  ROUTE_TOOL,
  RouteLegSchema,
  arrivalContext,
  buildRoutePrompt,
  fitRoute,
  LEG_TOOL,
  buildLegPrompt,
  soonMonth,
  type RouteLeg,
  checkDay,
  dayCheckOptions,
  dayFixText,
  ensureLandmarks,
  isClubCandidate,
  isReturnVisit,
  nightContext,
  nightPlan,
  nightRules,
  stopRole,
  BLOCKED_REDIRECT,
  inEastJerusalem,
  pulseCandidates,
  regionPolicy,
  scoreCandidate,
  wantsClubs,
  wantsNightlife,
  type CheckedStop,
  type DayCheckOptions,
  type NightPlan,
  type NightPulse,
  friendBadge,
  matchFriendCandidate,
  withFriendCandidates,
} from "@travel/core";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import type { Ctx } from "./auth";
import { callTool } from "./claude";
import { syncFeedback } from "./feedback";
import { friendSource, friendsForTrip, isGuest, type FriendSource } from "./friends";
import { adultsFor, attachLiveRates } from "./hotels";
import { HttpError } from "./http";
import { nightPulse, readPulse } from "./nightPulse";
import { PlacesError, placeById, placesCandidates, placesEnabled, verifyPlace } from "./places";
import { supabaseAdmin } from "./supabase/server";
import { tasteBlock } from "./taste";
import { addFriendsOnCreate, companionsFromHandles, editPeople } from "./together";
import { rateLimit, updateTrip } from "./tripAccess";
import { idealDays } from "./tripLength";
import { readStayScale, stayScale } from "./stayScale";
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
  // Older picks give a dollar band: read through the city's hotel prices (stayPrice.ts).
  const [{ data, error }, scale] = await Promise.all([q, readStayScale(city).catch(() => null)]);
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
    priceBand: p.price_band ? stayTier(p.price_band, scale) : null,
    expediaPropertyId: p.expedia_property_id,
  }));
}

/** `friends`: the trip owner's friends' places there (friends.ts), ahead of the rest. */
async function gatherCandidates(req: TripRequest, staysOnly = false, friends?: FriendSource): Promise<Candidate[]> {
  const queries = placesQueries(req).filter((q) => !staysOnly || q.category === "stay");
  const [picks, fromFriends, ...places] = await Promise.allSettled([
    localPickCandidates(req.destination, staysOnly),
    friends ? friends.candidates(req.destination, staysOnly) : Promise.resolve([]),
    ...queries.map((q) => placesCandidates(q.query, q.category, 8)),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T[]> | undefined) => (r?.status === "fulfilled" ? r.value : []);
  const all = withFriendCandidates(ok(fromFriends), [...ok(picks), ...places.flatMap((p) => ok(p))]);
  // Jerusalem: Palestinian businesses only, so nothing Google finds in West Jerusalem (region.ts).
  return regionPolicy(req.destination) === "jerusalem" ? all.filter(inEastJerusalem) : all;
}

/** Asking for a trip in Israel: the client sends the traveler to the owner's chosen page instead (region.ts). */
const blockedDestination = () => new HttpError(403, "Pylos doesn't plan trips there.", "blocked_destination", BLOCKED_REDIRECT);

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
    // Only verification below may set these; never trust the model's own values.
    delete p.place;
    delete (p as Hotel).liveRate;
    delete (p as Stop).hot;
    delete p.friend;
    p.expediaPropertyId = null;
    // A friend's place the model named without its id is still that friend's pick.
    const cand = (p.candidateId ? byId.get(p.candidateId) : undefined) ?? matchFriendCandidate(cands, p.name);
    if (cand) {
      p.candidateId = cand.id;
      p.origin = cand.origin;
      p.source = cand.source; // the candidate's real source wins over the model's label
      // "Sara's pick" comes only from a friend's candidate (friends.ts).
      if (cand.friends?.length) p.friend = friendBadge(cand.friends);
      if (cand.category === "stay") p.expediaPropertyId = cand.expediaPropertyId ?? null;
      // "Hot right now" comes only from the night pulse's dated sources (nightPulse.ts).
      if (cand.hot && cand.category !== "stay") (p as Stop).hot = cand.hot;
    } else {
      p.candidateId = null;
      p.origin = "ai";
      if (p.source === "friends") p.source = "guidebooks"; // not a friend's place, whatever the label says
    }
    try {
      // A Google candidate already carries its details from the search; others are looked up.
      const v = cand?.verification ?? (cand?.placeId ? await placeById(cand.placeId) : await verifyPlace(p.name, p.neighborhood ?? "", city));
      if (v) {
        if (v.status === "CLOSED_PERMANENTLY") drop.add(p);
        else p.place = v;
      } else if (p.origin === "ai" && placesEnabled()) {
        drop.add(p); // the model named a place we can't find: leave it out
      }
    } catch (e) {
      // Google couldn't be asked (already logged): keep the pick, unverified, as with no key.
      if (!(e instanceof PlacesError)) console.error("verify failed", p.name, e);
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
const TOO_MANY_BUILDS = "You've built a lot of trips this hour. Try again a little later.";

/**
 * Count one trip build against the hourly limit, before any work. Routes that do slow work of their
 * own before generateTrip (reading a Typeform response) call this first and pass `counted: true`.
 */
export const countBuild = (ctx: Ctx, limit: number) => rateLimit(ctx, "build", limit, TOO_MANY_BUILDS);

async function checkRateLimit(ctx: Ctx, limit: number, counted = false) {
  if (!counted) await countBuild(ctx, limit);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await ctx.db
    .from("trips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user!.id)
    .gte("created_at", since);
  if ((count ?? 0) >= limit) throw new HttpError(429, TOO_MANY_BUILDS, "rate_limited");
}

// ---------------------------------------------------------------------------
// Public pipeline
// ---------------------------------------------------------------------------
export type Emit = (e: BuildEvent) => void;

const DayResultSchema = z.object({
  theme: z.preprocess((v) => (typeof v === "string" ? v.slice(0, 160) : undefined), z.string().optional()),
  stops: salvage(StopSchema, 1, 8),
});

/**
 * Run a model step, retrying if the answer doesn't validate. `run(attempt)` is called with
 * 0, 1, … so the caller can choose the model per attempt (fast first, main model last).
 */
async function step<T>(
  label: string,
  run: (attempt: number) => Promise<{ input: unknown; model: string }>,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  attempts = 2,
): Promise<{ data: T; model: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { input, model } = await run(attempt);
      const parsed = schema.safeParse(input);
      if (parsed.success) return { data: parsed.data, model };
      console.error(`${label} failed validation (attempt ${attempt + 1})`, JSON.stringify(parsed.error.issues.slice(0, 4)), JSON.stringify(input).slice(0, 600));
    } catch (e) {
      // A bad or cut-off answer gets another try; outages and auth errors don't.
      if (!(e instanceof HttpError) || !["bad_output", "too_long"].includes(e.code ?? "")) throw e;
      console.error(`${label} attempt ${attempt + 1}: ${e.code}`);
      lastErr = e;
    }
  }
  if (lastErr instanceof HttpError && lastErr.code === "too_long") throw lastErr;
  throw new HttpError(502, "The plan came back incomplete. Try again.", "bad_output");
}

/**
 * Each stop as the day check sees it: its role (coffee, meal, sight…, trusting Google's place types
 * for places found by a Places search), and whether it's a real candidate rather than the model's own idea.
 */
function rolesFor(stops: Stop[], cands: Candidate[]): CheckedStop[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  return stops.map((s) => {
    const c = s.candidateId ? byId.get(s.candidateId) : undefined;
    return { name: s.name, time: s.time, kind: s.kind, cost: s.cost, grounded: !!c, role: stopRole(s, c?.origin === "google" ? (c.tags ?? []) : []) };
  });
}

/** A draft day, one stop per line, for showing the model what it has to fix. */
const draftText = (stops: CheckedStop[]) => stops.map((s, i) => `${i + 1}. ${s.time} ${s.name} (${s.role}${s.cost ? `, ${s.cost}` : ""})`).join("\n");

/**
 * The day check's options for day `i`: what the traveler asked for, where they are, and tonight's
 * plan. A club night is only enforced when there's a club among the candidates to choose from.
 */
function checkOptions(
  req: TripRequest,
  place: string,
  nights: readonly NightPlan[],
  i: number,
  cands: Candidate[],
  more: { mustSee?: readonly string[]; hint?: string } = {},
): DayCheckOptions {
  return {
    ...dayCheckOptions({ notes: req.extra, hint: more.hint }, more.mustSee ?? []),
    place,
    clubNight: nights[i] === "club" && !more.hint && cands.some(isClubCandidate),
    lateStart: i > 0 && nights[i - 1] === "club",
  };
}

/** `deadline` (ms since the epoch) must be passed on to callTool: the rebuild has to be over by then. */
type Rebuild = (fix: { draft: string; problems: string }, attempt: number, deadline: number) => Promise<{ input: unknown; model: string }>;

/**
 * The day check (packages/core/src/quality.ts). A planned day that breaks the rules (four cafés,
 * nothing to see, a missing essential) is rebuilt once with its problems spelled out, if there's
 * time left. The rebuild is kept unless it's worse, and if it fails the first draft stands, so
 * the check can only make a day better.
 *
 * `until`: a rebuild starts only before this time. `deadline`: every call the rebuild makes must
 * be over by then (callTool shortens its timeout and drops its retry), so it can't outlive the route.
 */
async function balanceDay(
  label: string,
  stops: Stop[],
  cands: Candidate[],
  opts: DayCheckOptions,
  rebuild: Rebuild,
  until = Number.POSITIVE_INFINITY,
  deadline = Number.POSITIVE_INFINITY,
): Promise<{ stops: Stop[]; theme?: string }> {
  const first = rolesFor(stops, cands);
  const issues = checkDay(first, opts);
  if (!issues.length) return { stops };
  const codes = issues.map((i) => i.code).join(", ");
  if (Date.now() > until) {
    console.warn(`${label} failed the day check (${codes}); no time left to rebuild it`);
    return { stops };
  }
  console.warn(`${label} failed the day check (${codes}); rebuilding`);
  try {
    const { data } = await step(`${label} rebuild`, (attempt) => rebuild({ draft: draftText(first), problems: dayFixText(issues) }, attempt, deadline), DayResultSchema, 2);
    const after = checkDay(rolesFor(data.stops, cands), opts);
    if (after.length > issues.length) return { stops };
    if (after.length) console.warn(`${label} rebuild still has: ${after.map((i) => i.code).join(", ")}`);
    return { stops: data.stops, theme: data.theme };
  } catch (e) {
    console.error(`${label} rebuild failed; keeping the first draft`, e);
    return { stops };
  }
}

/** A rebuild asks the fast model first, the main model only if the answer comes back malformed. */
// ---------------------------------------------------------------------------
// The night pulse (nightPulse.ts): the bars and clubs that are hot right now
// ---------------------------------------------------------------------------

/**
 * Nightlife travelers: the city's night pulse. Cached for a month; when there isn't one, it's
 * researched now (30–60 s) and keeps going after the trip is ready, so the next trip has it.
 */
function startPulse(req: TripRequest, city: string, deadline: number): Promise<NightPulse | null> | null {
  // Not for Jerusalem: its trips use only Palestinian businesses, which the pulse doesn't check.
  if (!wantsNightlife(req) || regionPolicy(city) !== "ok") return null;
  const job = nightPulse(city, deadline);
  waitUntil(job);
  return job;
}

/** The value if the promise settles within `ms`, else null (the promise keeps running). */
async function within<T>(p: Promise<T | null> | null, ms: number): Promise<T | null> {
  if (!p) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Where the places Google found are, to keep the pulse to places near the trip. */
const locations = (cands: Candidate[]) =>
  cands.flatMap((c) => (c.verification?.lat != null && c.verification.lng != null ? [{ lat: c.verification.lat, lng: c.verification.lng }] : []));

/**
 * The pulse's places as candidates, ahead of the rest: when Google's search found the same place,
 * the pulse's copy (with "Hot right now" and its door notes) is the one kept.
 */
function withPulse(gathered: Candidate[], pulse: NightPulse | null): Candidate[] {
  return pulse ? [...pulseCandidates(pulse, { near: locations(gathered) }), ...gathered] : gathered;
}

/** Pulse places that arrived after the outline, added for the day plans (up to 8 not already there). */
function latePulse(cands: Candidate[], pulse: NightPulse | null, eff: EffectiveSources, req: TripRequest): Candidate[] {
  if (!pulse) return [];
  const have = new Set(cands.map((c) => c.placeId ?? c.id));
  return pulseCandidates(pulse, { near: locations(cands) })
    .filter((c) => !have.has(c.placeId ?? c.id) && Number.isFinite(scoreCandidate(c, eff, req)))
    .slice(0, 8);
}

const fastThenMainOnce = (attempt: number, deadline?: number) => ({
  fast: attempt === 0,
  deadline: deadline !== undefined && Number.isFinite(deadline) ? deadline : undefined,
});

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

/** The traveler's logged places, as a prompt block. Empty if none (or before the community migration). */
/** Someone else planning this trip with the owner: their taste is blended into the plan. */
export interface Companion {
  userId: string;
  label: string;
}

/**
 * What the planner knows about the people on this trip: where the owner has been, and everyone's
 * taste (profile + favorite places), so hotel and restaurant picks fit them.
 * `ownerId` defaults to the caller; pass it when a friend edits someone else's trip.
 */
export async function loadHistory(ctx: Ctx, destination: string, people: { ownerId?: string; companions?: Companion[] } = {}): Promise<string> {
  if (!ctx.user) return "";
  const ownerId = people.ownerId ?? ctx.user.id;
  const companions = (people.companions ?? []).filter((c) => c.userId !== ownerId);
  const [history, taste] = await Promise.all([
    ownerId === ctx.user.id ? pastTripsBlock(ctx, destination) : Promise.resolve(""),
    tasteBlock([{ userId: ownerId, label: companions.length ? "Trip owner" : null }, ...companions], destination).catch((e) => {
      console.error("taste block failed", e);
      return "";
    }),
  ]);
  return [history, taste].filter(Boolean).join("\n\n");
}

async function pastTripsBlock(ctx: Ctx, destination: string): Promise<string> {
  if (!ctx.user) return "";
  const { data, error } = await ctx.db
    .from("past_trips")
    .select("id, city, country_code, year, month, days, rating, highlights, trip_id")
    .eq("user_id", ctx.user.id)
    .limit(200);
  if (error || !data?.length) return "";
  const places: PastTrip[] = data.map((r) => ({
    id: r.id,
    city: r.city,
    countryCode: r.country_code,
    year: r.year,
    month: r.month,
    days: r.days,
    rating: r.rating,
    highlights: r.highlights ?? "",
    tripId: r.trip_id,
  }));
  return historyForPrompt(places, destination, countryName);
}

/** Visibility for a new trip: the owner's community default, or private. */
async function defaultVisibility(ctx: Ctx): Promise<Visibility> {
  if (!ctx.user) return "private";
  const { data } = await ctx.db.from("community_profiles").select("default_visibility").eq("user_id", ctx.user.id).maybeSingle();
  return (data?.default_visibility as Visibility | undefined) ?? "private";
}

const withHistory = (history: string, prompt: string) => (history ? `${history}\n\n${prompt}` : prompt);

/** The trip's personal line, only when there was history to draw on: never a general description. */
const personalLine = (history: string, line: string) => (history ? line.trim() : "");

/**
 * Whether to make sure of the place's famous sights (ensureLandmarks): not for someone who has been
 * before (they get places a first-timer wouldn't know), nor on a one-day food or café crawl they
 * asked for.
 */
function wantsLandmarks(req: TripRequest, history: string): boolean {
  if (isReturnVisit(history)) return false;
  const ask = dayCheckOptions({ notes: req.extra });
  return !(req.days <= 1 && (ask.foodFocus || ask.coffeeFocus));
}

/** Postgres/PostgREST "column doesn't exist" — the community migration hasn't been run yet. */
const missingColumn = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");

export interface PlanInputs {
  eff: EffectiveSources;
  lists: CuratorLists;
  /** The traveler's travel history block for prompts (may be empty). */
  history: string;
  /** Days that fail the day check are rebuilt only before this time (ms), so a build stays inside its time limit. */
  rebuildUntil?: number;
  /** Every model call a rebuild makes must be over by this time (ms): the hard stop under the route's limit. */
  rebuildDeadline?: number;
  /** What hotels cost in the destination (stayPrice.ts), for the hotel prompts; may still be on its way. */
  stayScale?: Promise<StayScale | null> | null;
  /** Friends' places as candidates (friends.ts). */
  friends?: FriendSource;
}

type CuratorLists = { alwaysFeature: string; neverRecommend: string };
type DayOut = Itinerary["days"][number];

/** Fast model first; if the answer is malformed, fast again; the main model only as a last resort. */
const fastThenMain = (attempt: number) => ({ fast: attempt < 2 });

/** Per-day request for a multi-city trip: the day's city becomes the destination. */
export function requestForCity(req: TripRequest, city: string | undefined): TripRequest {
  if (!city || req.mode !== "multi") return req;
  return { ...req, mode: "single", destination: `${city}, ${req.destination}` };
}

/**
 * Plan an itinerary (not saved). Single place: a quick outline, then every day and the hotels
 * at once. Several stops: the route first, then every day and each stop's hotels at once.
 * Every finished day is emitted straight away so the client can show it.
 */
export async function planItinerary(req: TripRequest, inputs: PlanInputs, emit: Emit = () => {}): Promise<{ itin: Itinerary; model: string }> {
  if (regionPolicy(req.destination) === "blocked") throw blockedDestination();
  // The build route allows 120 s. A day is rebuilt only if its first draft is back within 50 s, and
  // the rebuild's calls must be over by 110 s (callTool's deadline), leaving time to check and save.
  const start = Date.now();
  const withLimit = {
    ...inputs,
    rebuildUntil: inputs.rebuildUntil ?? start + 50_000,
    rebuildDeadline: inputs.rebuildDeadline ?? start + 110_000,
  };
  const out = req.mode === "multi" ? await planMulti(req, withLimit, emit) : await planSingle(req, withLimit, emit);
  dedupeAcrossDays(out.itin);
  emit({ type: "progress", pct: 88, label: placesEnabled() ? "Checking every place on the map" : "Finishing touches" });
  await groundByCity(out.itin, out.candsByCity, req);
  return { itin: out.itin, model: out.model };
}

interface Planned {
  itin: Itinerary;
  model: string;
  /** Candidates per city key ("" for a single-place trip), used for grounding. */
  candsByCity: Map<string, Candidate[]>;
}

async function planSingle(req: TripRequest, { eff, lists, history, rebuildUntil, rebuildDeadline, stayScale: scaleJob, friends }: PlanInputs, emit: Emit): Promise<Planned> {
  const progress = (pct: number, label: string) => emit({ type: "progress", pct, label });
  progress(8, "Gathering local picks");
  // Nightlife: the bars and clubs that are hot now, if this city's pulse is ready in time.
  const pulseJob = startPulse(req, req.destination, rebuildDeadline ?? Date.now() + 100_000);
  const [gathered, early] = await Promise.all([gatherCandidates(req, false, friends), within(pulseJob, 8_000)]);
  const cands = selectCandidates(withPulse(gathered, early), eff, req);

  progress(15, `Sketching your ${req.days}-day outline`);
  const { data: outline, model } = await step(
    "outline",
    (attempt) => callTool(withHistory(history, buildOutlinePrompt(req, eff, lists, cands)), OUTLINE_TOOL, attempt ? 4000 : 2500, fastThenMain(attempt)),
    OutlineSchema,
    3,
  );
  const o: Outline = { ...outline, forYou: personalLine(history, outline.forYou), days: outline.days.slice(0, req.days) };
  // What the place is famous for, checked in code: the outline's own essentials come from the fast model.
  if (wantsLandmarks(req, history)) {
    const { days, added } = ensureLandmarks(o.days, cands, { days: req.days });
    if (added.length) console.log(`[outline] made sure of ${added.join(", ")}`);
    o.days = days;
  }
  // Each night: drinks, a club (when they asked), or nothing in particular. Chosen in code, the same way the outline was told.
  o.nights = nightPlan(req, o.days.length);
  // A pulse that came in during the outline still reaches the day plans.
  if (!early) cands.push(...latePulse(cands, await within(pulseJob, 0), eff, req));
  emit({ type: "outline", title: o.title, forYou: o.forYou, days: o.days.map((d) => ({ label: d.label, theme: d.theme })), hotels: req.stay.on });

  const jobs = o.days.length + (req.stay.on ? 1 : 0);
  let finished = 0;
  const tick = (label: string) => {
    finished++;
    progress(30 + Math.round((finished / jobs) * 55), label);
  };
  progress(30, "Planning every day at once");

  const dayJobs = o.days.map(async (d, i): Promise<DayOut> => {
    const { data } = await step(
      `day ${i + 1}`,
      (attempt) => callTool(withHistory(history, buildPlanDayPrompt(req, eff, lists, o, i, cands)), DAY_TOOL, 4000, fastThenMain(attempt)),
      DayResultSchema,
      3,
    );
    const balanced = await balanceDay(
      `day ${i + 1}`,
      data.stops,
      cands,
      checkOptions(req, req.destination, o.nights ?? [], i, cands, { mustSee: d.mustSee }),
      (fix, attempt, deadline) =>
        callTool(withHistory(history, buildPlanDayPrompt(req, eff, lists, o, i, cands, "", fix)), DAY_TOOL, 4000, fastThenMainOnce(attempt, deadline)),
      rebuildUntil,
      rebuildDeadline,
    );
    const day: DayOut = { label: d.label || `Day ${i + 1}`, theme: balanced.theme || data.theme || d.theme, stops: balanced.stops };
    emit({ type: "day", index: i, day });
    tick(`${day.label} planned`);
    return day;
  });
  const hotelJob = req.stay.on
    ? planHotels(req, eff, lists, history, o.days.map((d) => d.area).filter(Boolean), cands.filter((c) => c.category === "stay"), 3, emit, tick, undefined, scaleJob)
    : Promise.resolve([] as Hotel[]);

  const [days, hotels] = await Promise.all([Promise.all(dayJobs), hotelJob]);
  const itin: Itinerary = ItinerarySchema.parse({ title: o.title, forYou: o.forYou, notes: o.notes, days, hotels, replaced: [], mode: "single" });
  if (itin.hotels.length) itin.stayLabel = stayLabel(req.stay);
  return { itin, model, candsByCity: new Map([["", cands]]) };
}

async function planHotels(
  req: TripRequest,
  eff: EffectiveSources,
  lists: CuratorLists,
  history: string,
  areas: string[],
  stayCands: Candidate[],
  count: number,
  emit: Emit,
  tick: (label: string) => void,
  city?: string,
  scaleJob?: Promise<StayScale | null> | null,
): Promise<Hotel[]> {
  try {
    // What hotels cost there, so the prompt can say what the tier means locally.
    const scale = await within(scaleJob ?? null, 4_000);
    const { data } = await step(
      `hotels${city ? ` ${city}` : ""}`,
      (attempt) => callTool(withHistory(history, buildHotelPromptForAreas(req, eff, lists, areas, stayCands, count, scale)), HOTELS_TOOL, 3000, fastThenMain(attempt)),
      z.object({ hotels: salvage(HotelSchema, 1, 5) }),
    );
    const hotels = data.hotels.slice(0, count).map((h) => (city ? { ...h, city } : h));
    emit({ type: "hotels", hotels });
    return hotels;
  } catch (e) {
    console.error("hotels step failed; trip continues without hotels", e);
    emit({ type: "hotels", hotels: [] });
    return [];
  } finally {
    tick(city ? `Places to stay in ${city}` : "Places to stay picked");
  }
}

const RouteSchema = z.object({
  title: z.string().trim().min(1).transform((v) => v.slice(0, 140)),
  forYou: z.string().catch("").default("").transform((v) => v.trim().slice(0, 300)),
  notes: salvage(z.string().transform((v) => v.slice(0, 300)), 0, 6).default([]),
  legs: salvage(RouteLegSchema, 1, 8),
});

async function planMulti(req: TripRequest, { eff, lists, history, rebuildUntil, rebuildDeadline, stayScale: scaleJob, friends }: PlanInputs, emit: Emit): Promise<Planned> {
  const progress = (pct: number, label: string) => emit({ type: "progress", pct, label });
  progress(8, `Mapping a route through ${req.destination}`);
  const { data: route, model } = await step(
    "route",
    (attempt) => callTool(withHistory(history, buildRoutePrompt(req, eff, lists)), ROUTE_TOOL, attempt ? 5000 : 3500),
    RouteSchema,
  );
  // No stops (or swaps) in Israel, whatever the route came back with (region.ts).
  const allowed = route.legs
    .filter((l) => regionPolicy(l.city) !== "blocked")
    .map((l) => ({ ...l, alternatives: l.alternatives?.filter((a) => regionPolicy(a.city) !== "blocked") }));
  if (route.legs.length && !allowed.length) throw blockedDestination();
  const legs = fitRoute(allowed, req.days);
  if (!legs.length) throw new HttpError(502, "We couldn't plan a route for that. Try a different country or more days.", "bad_output");

  // Flatten the route into days, remembering each day's stop.
  const plan: { leg: number; within: number; label: string; theme: string; area: string; city: string }[] = [];
  legs.forEach((l, li) =>
    l.dayThemes.forEach((t, k) => plan.push({ leg: li, within: k, label: `Day ${plan.length + 1}`, theme: t.theme, area: t.area || l.city, city: l.city })),
  );
  const forYou = personalLine(history, route.forYou);
  emit({
    type: "outline",
    title: route.title,
    forYou,
    days: plan.map((p) => ({ label: p.label, theme: p.theme, city: p.city })),
    hotels: req.stay.on,
    route: legs.map((l) => ({ city: l.city, days: l.days })),
  });

  progress(22, `Finding local picks in ${legs.map((l) => l.city).join(", ")}`);
  const legReqs = legs.map((l) => ({ ...requestForCity(req, l.city), days: l.days }));
  // Each stop's night pulse, when it's ready in time (otherwise it's researched for next time).
  const pulseJobs = legReqs.map((r) => startPulse(req, r.destination, rebuildDeadline ?? Date.now() + 100_000));
  const legCands = await Promise.all(
    legReqs.map(async (r, i) => {
      const [gathered, pulse] = await Promise.all([gatherCandidates(r, false, friends), within(pulseJobs[i]!, 8_000)]);
      return selectCandidates(withPulse(gathered, pulse), eff, r);
    }),
  );

  // Each stop gets its own outline, so a day knows the other days in the same place, and each stop
  // keeps what it's famous for (not on the day they arrive, when another day there works).
  const landmarks = wantsLandmarks(req, history);
  // Club nights (when asked): not the night they arrive somewhere new, nor the night before they
  // move on, unless that leaves none at all.
  const arrivals = plan.flatMap((p, i) => (p.within === 0 && p.leg > 0 ? [i] : []));
  const moving = plan.flatMap((p, i) => (p.within === legs[p.leg]!.days - 1 && p.leg < legs.length - 1 ? [i] : []));
  let nights = nightPlan(req, plan.length, [...arrivals, ...moving]);
  if (wantsClubs(req) && !nights.includes("club")) nights = nightPlan(req, plan.length, arrivals);
  const legOutlines: Outline[] = legs.map((l, li) => {
    const ids = legCands[li]!.filter((c) => c.category !== "stay").map((c) => c.id);
    const days = l.dayThemes.map((t, k) => ({
      label: plan.find((p) => p.leg === li && p.within === k)!.label,
      theme: t.theme,
      area: t.area || l.city,
      candidateIds: ids.filter((_, j) => j % l.days === k).slice(0, 6),
    }));
    const legNights = plan.flatMap((p, i) => (p.leg === li ? [nights[i]!] : []));
    if (!landmarks) return { title: route.title, forYou: "", notes: [], days, nights: legNights };
    const sure = ensureLandmarks(days, legCands[li]!, { days: l.days, avoid: li > 0 ? [0] : [] });
    if (sure.added.length) console.log(`[route] ${l.city}: made sure of ${sure.added.join(", ")}`);
    return { title: route.title, forYou: "", notes: [], days: sure.days, nights: legNights };
  });

  const jobs = plan.length + (req.stay.on ? legs.length : 0);
  let finished = 0;
  const tick = (label: string) => {
    finished++;
    progress(30 + Math.round((finished / jobs) * 55), label);
  };
  progress(30, "Planning every day at once");

  const dayJobs = plan.map(async (p, i): Promise<DayOut> => {
    const leg = legs[p.leg]!;
    const context =
      p.within === 0 && p.leg > 0
        ? arrivalContext(leg, legs[p.leg - 1]!.city)
        : p.within === leg.days - 1 && p.leg < legs.length - 1
          ? `Tomorrow they travel on to ${legs[p.leg + 1]!.city}; keep the evening easy.`
          : "";
    const { data } = await step(
      `day ${i + 1}`,
      (attempt) =>
        callTool(
          withHistory(history, buildPlanDayPrompt(legReqs[p.leg]!, eff, lists, legOutlines[p.leg]!, p.within, legCands[p.leg]!, context)),
          DAY_TOOL,
          4000,
          fastThenMain(attempt),
        ),
      DayResultSchema,
      3,
    );
    const balanced = await balanceDay(
      `day ${i + 1}`,
      data.stops,
      legCands[p.leg]!,
      checkOptions(req, leg.city, legOutlines[p.leg]!.nights ?? [], p.within, legCands[p.leg]!, { mustSee: legOutlines[p.leg]!.days[p.within]?.mustSee }),
      (fix, attempt, deadline) =>
        callTool(
          withHistory(history, buildPlanDayPrompt(legReqs[p.leg]!, eff, lists, legOutlines[p.leg]!, p.within, legCands[p.leg]!, context, fix)),
          DAY_TOOL,
          4000,
          fastThenMainOnce(attempt, deadline),
        ),
      rebuildUntil,
      rebuildDeadline,
    );
    const t = leg.transfer;
    const day: DayOut = {
      label: p.label,
      theme: balanced.theme || data.theme || p.theme,
      city: p.city,
      arrival: p.within === 0 && p.leg > 0 && t ? [`From ${legs[p.leg - 1]!.city}`, t.mode, t.duration, t.note].filter(Boolean).join(" · ") : undefined,
      stops: balanced.stops,
    };
    emit({ type: "day", index: i, day });
    tick(`${day.label} planned`);
    return day;
  });

  const hotelJobs = req.stay.on
    ? legs.map((l, li) =>
        planHotels(
          legReqs[li]!,
          eff,
          lists,
          history,
          l.dayThemes.map((t) => t.area).filter(Boolean),
          legCands[li]!.filter((c) => c.category === "stay"),
          2,
          emit,
          tick,
          l.city,
          scaleJob,
        ),
      )
    : [];

  const [days, hotelLists] = await Promise.all([Promise.all(dayJobs), Promise.all(hotelJobs)]);
  const itin: Itinerary = ItinerarySchema.parse({
    title: route.title,
    forYou,
    notes: route.notes,
    days,
    hotels: hotelLists.flat(),
    replaced: [],
    mode: "multi",
    route: legs.map(({ dayThemes: _t, ...l }) => ({ ...l, dayThemes: [] })),
  });
  if (itin.hotels.length) itin.stayLabel = stayLabel(req.stay);
  return { itin, model, candsByCity: new Map(legs.map((l, li) => [l.city, legCands[li]!])) };
}

/** Verify stops and hotels against the right city (each stop's city on a multi-city trip). */
async function groundByCity(itin: Itinerary, candsByCity: Map<string, Candidate[]>, req: TripRequest) {
  if (itin.mode !== "multi") {
    await groundItinerary(itin, candsByCity.get("") ?? [], req.destination);
    return;
  }
  const cities = [...new Set([...itin.days.map((d) => d.city ?? ""), ...itin.hotels.map((h) => h.city ?? "")])];
  const drop = new Set<Pick>();
  await Promise.all(
    cities.map(async (city) => {
      const picks: Pick[] = [...itin.days.filter((d) => (d.city ?? "") === city).flatMap((d) => d.stops), ...itin.hotels.filter((h) => (h.city ?? "") === city)];
      const d = await ground(picks, candsByCity.get(city) ?? [], city ? `${city}, ${req.destination}` : req.destination);
      d.forEach((p) => drop.add(p));
    }),
  );
  itin.days = itin.days.map((d) => ({ ...d, stops: d.stops.filter((s) => !drop.has(s)) })).filter((d) => d.stops.length > 0);
  itin.hotels = itin.hotels.filter((h) => !drop.has(h));
  if (!itin.days.length) throw new HttpError(502, "We couldn't verify enough places for this trip. Try again or adjust the request.", "unverified");
}

/**
 * `opts.counted`: the caller already counted this build (countBuild), so it isn't counted twice.
 * `opts.like`: "Plan a trip like this" (a past trip id; ignored unless this traveler may see it).
 */
export async function generateTrip(ctx: Ctx, reqIn: TripRequest, opts: { ip: string; tripsPerHour: number; counted?: boolean; like?: string | null }, emit: Emit = () => {}) {
  const t0 = Date.now();
  // No date and no month given (Typeform, the app): plan for the weeks ahead, so stops suit the season.
  // An explicit null means "not sure yet": an evergreen route.
  let req: TripRequest = reqIn.month === undefined && !reqIn.startDate ? { ...reqIn, month: soonMonth() } : reqIn;
  // Before anything is counted or looked up.
  if (regionPolicy(req.destination) === "blocked") throw blockedDestination();
  emit({ type: "progress", pct: 3, label: "Reading your request" });
  // Planning with friends: blend their taste in from the start.
  const companions = await companionsFromHandles(ctx, req.with ?? []);
  const [, { eff, lists }, history, visibility] = await Promise.all([
    checkRateLimit(ctx, opts.tripsPerHour, opts.counted),
    loadSources(ctx),
    loadHistory(ctx, req.destination, { companions }),
    defaultVisibility(ctx),
  ]);
  // How long most people stay there, asked alongside the plan once the build is allowed
  // (cached per destination; never throws). It finishes even if the build fails, for next time.
  const lengthJob = idealDays(req.destination, req.mode);
  waitUntil(lengthJob);
  // What hotels cost there (cached per destination). Hotel prices are tiers judged against it; an
  // answer in dollars (the Typeform asks that way) becomes the tier it buys there.
  const scaleJob = req.stay.on ? stayScale(req.destination) : null;
  if (scaleJob) waitUntil(scaleJob);
  if (!isStayTier(req.stay.price)) req = { ...req, stay: { ...req.stay, price: stayTier(req.stay.price, await within(scaleJob, 8_000)) } };

  const friends = friendSource(ctx.user!.id, { guest: isGuest(ctx), like: opts.like });
  const { itin, model } = await planItinerary(req, { eff, lists, history, stayScale: scaleJob, friends }, emit);
  console.log(`[build] planned ${req.mode} ${req.days}d in ${Date.now() - t0}ms`);
  const [ideal] = await Promise.all([within(lengthJob, 3_000), attachLiveRates(itin.hotels, req.startDate, req.days, adultsFor(req.party), opts.ip)]);
  if (ideal) itin.idealDays = ideal;

  emit({ type: "progress", pct: 96, label: "Saving your trip" });
  const row = {
    user_id: ctx.user!.id,
    destination: req.destination,
    title: itin.title,
    request: req,
    weights: eff.weights,
    blocked: eff.blocked,
    custom_mix: eff.custom,
    itinerary: itin,
    model,
  };
  const admin = supabaseAdmin();
  let { data, error } = await admin
    .from("trips")
    .insert({ ...row, city_key: cityKey(req.destination), visibility })
    .select("*")
    .single();
  if (missingColumn(error)) ({ data, error } = await admin.from("trips").insert(row).select("*").single());
  if (error || !data) throw new HttpError(500, "Your trip was built but couldn't be saved. Try again.");
  if (companions.length) await addFriendsOnCreate(ctx, (data as TripRow).id, companions);
  await friends.credit(data as TripRow);
  console.log(`[build] total ${Date.now() - t0}ms`);
  emit({ type: "progress", pct: 100, label: "Done" });
  return toTrip(data as TripRow);
}

export async function generateHotels(ctx: Ctx, row: TripRow, stay: StayPrefs, opts: { ip: string }) {
  // Whoever asks (the owner or a friend planning with them), the hotels are for everyone on the
  // trip: the owner's taste plus their friends', as for edits.
  const { companions } = await editPeople(row);
  const [{ lists }, history, scale] = await Promise.all([
    loadSources(ctx),
    loadHistory(ctx, row.request.destination, { ownerId: row.user_id, companions }),
    // What hotels cost there: the tier's local meaning, and an older trip's dollar band as a tier.
    stayScale(row.request.destination, Date.now() + 10_000),
  ]);
  const req: TripRequest = { ...row.request, stay: { ...stay, on: true, price: stayTier(stay.price, scale) } };
  const eff: EffectiveSources = { weights: row.weights, blocked: (row.blocked ?? []).filter(isSourceId), custom: row.custom_mix };
  const route = row.itinerary.mode === "multi" ? row.itinerary.route ?? [] : [];
  const friends = friendsForTrip(row, ctx);
  // One place: three hotels. Several stops: two per stop, each checked against its own city.
  const groups = route.length
    ? route.map((l) => ({ city: l.city, req: requestForCity(req, l.city), count: 2 }))
    : [{ city: undefined as string | undefined, req, count: 3 }];
  const found = await Promise.all(
    groups.map(async (g) => {
      const cands = selectCandidates(await gatherCandidates(g.req, true, friends), eff, g.req);
      const areas = [
        ...new Set(
          row.itinerary.days
            .filter((d) => !g.city || d.city === g.city)
            .flatMap((d) => d.stops.map((s) => s.neighborhood))
            .filter(Boolean),
        ),
      ].slice(0, 12);
      const { data } = await step(
        `hotels${g.city ? ` ${g.city}` : ""}`,
        (attempt) => callTool(withHistory(history, buildHotelPromptForAreas(g.req, eff, lists, areas, cands, g.count, scale)), HOTELS_TOOL, 3000, fastThenMain(attempt)),
        z.object({ hotels: salvage(HotelSchema, 1, 5) }),
      );
      const hotels = data.hotels.slice(0, g.count).map((h) => (g.city ? { ...h, city: g.city } : h));
      const drop = await ground(hotels, cands, g.req.destination);
      return hotels.filter((h) => !drop.has(h));
    }),
  );
  const kept = found.flat();
  if (!kept.length) throw new HttpError(502, "We couldn't verify any hotels for this trip. Try a different style or price.", "unverified");
  await attachLiveRates(kept, req.startDate, req.days, adultsFor(req.party), opts.ip);

  const itinerary: Itinerary = { ...row.itinerary, hotels: kept, stayLabel: stayLabel(req.stay) };
  // Hotel votes refer to positions in the old list; clear them.
  const votes = Object.fromEntries(Object.entries(row.votes ?? {}).filter(([k]) => !k.startsWith("h-")));
  const saved = await updateTrip(row, { itinerary, request: req, votes });
  await syncFeedback(saved);
  return friends.credit(saved);
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

async function saveEdit(row: TripRow, itinerary: Itinerary, votes: TripRow["votes"]): Promise<TripRow> {
  const saved = await updateTrip(row, { itinerary, votes });
  await syncFeedback(saved);
  return saved;
}

/** Friends planning a trip together: their taste is blended into swaps and rebuilt days. */
export interface EditPeople {
  companions: Companion[];
  /** Stops someone said they're in for, by "day-stop" key (with the place name, so swaps reset it). */
  liked: Map<string, string>;
}
const noPeople: EditPeople = { companions: [], liked: new Map() };

function editContext(row: TripRow) {
  const req: TripRequest = row.request;
  const eff: EffectiveSources = { weights: row.weights, blocked: (row.blocked ?? []).filter(isSourceId), custom: row.custom_mix };
  const inTrip = new Set(
    [...row.itinerary.days.flatMap((d) => d.stops), ...(row.itinerary.hotels ?? [])].map((p) => p.name.toLowerCase()),
  );
  return { req, eff, inTrip };
}

export async function swapStop(ctx: Ctx, row: TripRow, day: number, index: number, hint: string, people: EditPeople = noPeople) {
  const old = row.itinerary.days[day]?.stops[index];
  if (!old) throw new HttpError(404, "That stop isn't in this trip anymore. Reload and try again.");
  await rateLimit(ctx, "edit", 60, "That's a lot of changes this hour. Try again a little later.");
  const { req: base, eff, inTrip } = editContext(row);
  const req = requestForCity(base, row.itinerary.days[day]?.city);
  const friends = friendsForTrip(row, ctx);
  const [{ lists }, gathered, history, pulse] = await Promise.all([
    loadSources(ctx),
    gatherCandidates(req, false, friends),
    loadHistory(ctx, req.destination, { ownerId: row.user_id, companions: people.companions }),
    wantsNightlife(req) ? readPulse(req.destination) : null,
  ]);
  const cands = selectCandidates(withPulse(gathered, pulse), eff, req).filter((c) => c.category !== "stay" && !inTrip.has(c.name.toLowerCase()));
  const { input } = await callTool(withHistory(history, buildSwapPrompt(req, eff, lists, row.itinerary, day, index, hint, cands)), STOP_TOOL, 2000, { fast: true });
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
  return friends.credit(await saveEdit(row, itinerary, votes));
}

export async function regenerateDay(ctx: Ctx, row: TripRow, day: number, hint: string, people: EditPeople = noPeople) {
  // The edit route allows 60 s; the rebuild below must be over by 55 s after this point.
  const began = Date.now();
  const current = row.itinerary.days[day];
  if (!current) throw new HttpError(404, "That day isn't in this trip anymore. Reload and try again.");
  await rateLimit(ctx, "edit", 60, "That's a lot of changes this hour. Try again a little later.");
  const { req: base, eff } = editContext(row);
  const req = requestForCity(base, current.city);
  const otherDays = new Set(
    [...row.itinerary.days.flatMap((d, i) => (i === day ? [] : d.stops)), ...(row.itinerary.hotels ?? [])].map((p) => p.name.toLowerCase()),
  );
  const friends = friendsForTrip(row, ctx);
  const [{ lists }, gathered, history, pulse] = await Promise.all([
    loadSources(ctx),
    gatherCandidates(req, false, friends),
    loadHistory(ctx, req.destination, { ownerId: row.user_id, companions: people.companions }),
    wantsNightlife(req) ? readPulse(req.destination) : null,
  ]);
  const cands = selectCandidates(withPulse(gathered, pulse), eff, req).filter((c) => c.category !== "stay" && !otherDays.has(c.name.toLowerCase()));
  // Planning together: stops someone said they're in for stay, like locked ones.
  const keep = current.stops.map((s, i) => !!s.locked || people.liked.get(`${day}-${i}`) === s.name);
  const started = Date.now();
  const marked: Itinerary = { ...row.itinerary, days: row.itinerary.days.map((d, i) => (i === day ? { ...d, stops: d.stops.map((s, j) => ({ ...s, locked: keep[j] })) } : d)) };
  // The trip's nights as built: a day with a club stop is a club night (and the next morning starts late).
  // (Only for trips that asked for clubs: older trips called bars "nightlife" too.)
  const nights: NightPlan[] = row.itinerary.days.map((d) =>
    wantsClubs(req) && d.stops.some((s) => s.kind === "nightlife") ? "club" : wantsNightlife(req) ? "drinks" : null,
  );
  const night = [nightRules(req, nights, row.itinerary.days.map((d) => d.label)), nightContext(nights, day)].filter(Boolean).join("\n");
  const prompt = (fix?: { draft: string; problems: string }) => buildDayPrompt(req, eff, lists, marked, day, hint, cands, fix, night);
  const { data: firstDraft } = await step("rebuild day", (attempt) => callTool(withHistory(history, prompt()), DAY_TOOL, 4000, fastThenMain(attempt)), DayResultSchema, 3);

  // Locked stops (and ones a friend is in for) are kept exactly, whatever the model returned.
  const locked = current.stops.filter((_, i) => keep[i]);
  const lockedNames = new Set(locked.map((s) => s.name.toLowerCase()));
  // The same day check as new trips, judged on the whole day (kept stops included). The edit route
  // allows 60 s, so a second pass only if the first came back quickly, and it must end by 55 s
  // (counted from the start of this function, which is earlier than `started`).
  const balanced = await balanceDay(
    "rebuilt day",
    sortByTime([...locked, ...firstDraft.stops.filter((s) => !lockedNames.has(s.name.toLowerCase()))]),
    cands,
    checkOptions(req, req.destination, nights, day, cands, { hint }),
    (fix, attempt, deadline) => callTool(withHistory(history, prompt(fix)), DAY_TOOL, 4000, fastThenMainOnce(attempt, deadline)),
    started + 25_000,
    began + 55_000,
  );
  const parsed = { data: { theme: balanced.theme ?? firstDraft.theme, stops: balanced.stops } };
  const fresh = parsed.data.stops
    .filter((s) => !lockedNames.has(s.name.toLowerCase()) && !otherDays.has(s.name.toLowerCase()))
    .map((s) => ({ ...s, locked: false }));
  const drop = await ground(fresh, cands, req.destination);
  const stops = sortByTime([...locked, ...fresh.filter((s) => !drop.has(s))]);
  if (!stops.length) throw new HttpError(502, "We couldn't verify places for the new day. Try again.", "unverified");

  const itinerary: Itinerary = structuredClone(row.itinerary);
  // Votes on replaced stops are retired; locked stops keep theirs at their new positions.
  const replacedKeys = current.stops.map((s, i) => (keep[i] ? null : `${day}-${i}`)).filter((k): k is string => !!k);
  const { votes: afterRetire, replaced } = retireVotes(row, replacedKeys, itinerary);
  const votes = Object.fromEntries(Object.entries(afterRetire).filter(([k]) => !k.startsWith(`${day}-`)));
  current.stops.forEach((s, i) => {
    const v = row.votes?.[`${day}-${i}`];
    if (keep[i] && v) votes[`${day}-${stops.indexOf(s)}`] = v;
  });
  itinerary.replaced = replaced;
  itinerary.days[day] = { ...current, theme: parsed.data.theme || current.theme, stops };
  return friends.credit(await saveEdit(row, itinerary, votes));
}

const LegResultSchema = RouteLegSchema.pick({ region: true, why: true, season: true, transfer: true, dayThemes: true, alternatives: true }).extend({
  found: z.boolean().catch(true).default(true),
  city: z.string().trim().min(1).transform((v) => v.slice(0, 80)),
  nextTransfer: RouteLegSchema.shape.transfer,
  title: z.string().catch("").default("").transform((v) => v.trim().slice(0, 140)),
});

const sameCity = (a: string, b: string) => cityKey(a) === cityKey(b);
const arrivalText = (from: string, t: RouteLeg["transfer"]) => (t ? [`From ${from}`, t.mode, t.duration, t.note].filter(Boolean).join(" · ") : undefined);

/**
 * Multi-city trips: replace one stop on the route with another town. Its days are planned again
 * (same number of days), with its hotels if the trip has them, the transfers either side, and
 * the trip's title. The stop it replaces becomes a swap, so it's one tap to go back.
 */
export async function swapCity(ctx: Ctx, row: TripRow, legIndex: number, cityIn: string, people: EditPeople = noPeople) {
  const it = row.itinerary;
  const route = it.mode === "multi" ? (it.route ?? []) : [];
  const old = route[legIndex];
  if (!old || route.length < 2) throw new HttpError(404, "That stop isn't on this trip anymore. Reload and try again.");
  const asked = cityIn.trim();
  if (regionPolicy(asked) === "blocked") throw blockedDestination();
  if (sameCity(asked, old.city)) return row;
  if (route.some((l, i) => i !== legIndex && sameCity(l.city, asked))) throw new HttpError(400, `${asked} is already on this trip.`, "duplicate");
  const dayIdx = it.days.map((d, i) => (d.city === old.city ? i : -1)).filter((i) => i >= 0);
  if (!dayIdx.length) throw new HttpError(409, "This trip just changed. Reload and try again.", "conflict");
  await rateLimit(ctx, "edit", 60, "That's a lot of changes this hour. Try again a little later.");

  const { req: base, eff } = editContext(row);
  const n = dayIdx.length;
  const [{ lists }, history] = await Promise.all([
    loadSources(ctx),
    loadHistory(ctx, base.destination, { ownerId: row.user_id, companions: people.companions }),
  ]);

  // 1. The new stop: a theme per day, how to get there and on, and swaps of its own.
  const { data: leg } = await step(
    "swap city",
    (attempt) => callTool(withHistory(history, buildLegPrompt(base, route, legIndex, asked, n, it.title)), LEG_TOOL, 2500, fastThenMain(attempt)),
    LegResultSchema,
    3,
  );
  if (!leg.found) throw new HttpError(400, `We couldn't find "${asked}". Check the spelling, or pick one of the suggestions.`, "not_found");
  const city = leg.city;
  // What they typed may resolve to a place in Israel ("Tel-Aviv" → "Tel Aviv").
  if (regionPolicy(city) === "blocked") throw blockedDestination();
  if (route.some((l, i) => i !== legIndex && sameCity(l.city, city))) throw new HttpError(400, `${city} is already on this trip.`, "duplicate");
  const prev = route[legIndex - 1];
  const next = route[legIndex + 1];
  const themes = Array.from({ length: n }, (_, k) => leg.dayThemes[k] ?? { theme: `${city} the local way`, area: city });

  // 2. Its days, and its hotels if the old stop had some, all at once.
  const legReq: TripRequest = { ...requestForCity(base, city), days: n };
  const oldHotels = (it.hotels ?? []).filter((h) => h.city === old.city);
  const elsewhere = new Set(
    [...it.days.filter((_, i) => !dayIdx.includes(i)).flatMap((d) => d.stops), ...(it.hotels ?? []).filter((h) => h.city !== old.city)].map((p) => p.name.toLowerCase()),
  );
  const friends = friendsForTrip(row, ctx);
  const cands = selectCandidates(await gatherCandidates(legReq, false, friends), eff, legReq).filter((c) => !elsewhere.has(c.name.toLowerCase()));
  const ids = cands.filter((c) => c.category !== "stay").map((c) => c.id);
  const outline: Outline = {
    title: leg.title || it.title,
    forYou: "",
    notes: [],
    days: themes.map((t, k) => ({ label: it.days[dayIdx[k]!]!.label, theme: t.theme, area: t.area || city, candidateIds: ids.filter((_, j) => j % n === k).slice(0, 6) })),
    // Not a club on the night they arrive.
    nights: nightPlan(legReq, n, legIndex > 0 ? [0] : []),
  };
  const dayJobs = themes.map(async (t, k): Promise<DayOut> => {
    const context =
      k === 0 && prev ? arrivalContext({ city, transfer: leg.transfer ?? null }, prev.city) : k === n - 1 && next ? `Tomorrow they travel on to ${next.city}; keep the evening easy.` : "";
    const { data } = await step(
      `swap day ${k + 1}`,
      (attempt) => callTool(withHistory(history, buildPlanDayPrompt(legReq, eff, lists, outline, k, cands, context)), DAY_TOOL, 4000, fastThenMain(attempt)),
      DayResultSchema,
      3,
    );
    return {
      label: it.days[dayIdx[k]!]!.label,
      theme: data.theme || t.theme,
      city,
      arrival: k === 0 && prev ? arrivalText(prev.city, leg.transfer) : undefined,
      stops: data.stops.filter((s) => !elsewhere.has(s.name.toLowerCase())).map((s) => ({ ...s, locked: false })),
    };
  });
  const hotelJob = oldHotels.length
    ? planHotels(legReq, eff, lists, history, themes.map((t) => t.area).filter(Boolean), cands.filter((c) => c.category === "stay"), Math.min(2, oldHotels.length), () => {}, () => {}, city, readStayScale(row.request.destination).catch(() => null))
    : Promise.resolve([] as Hotel[]);
  const [days, hotels] = await Promise.all([Promise.all(dayJobs), hotelJob]);

  // 3. Check the new places exist, in the new town.
  const seen = new Set<string>();
  const once = (s: Stop) => {
    const k = (s.candidateId || s.name).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const drop = await ground([...days.flatMap((d) => d.stops), ...hotels], cands, `${city}, ${base.destination}`);
  const newDays = days.map((d) => {
    const kept = d.stops.filter((s) => !drop.has(s));
    const fresh = kept.filter(once);
    return { ...d, stops: fresh.length >= 2 || fresh.length === kept.length ? fresh : kept };
  });
  if (newDays.some((d) => !d.stops.length)) throw new HttpError(502, `We couldn't verify enough places in ${city}. Try another town.`, "unverified");
  const newHotels = hotels.filter((h) => !drop.has(h));

  // 4. Put it together. Votes on the old stop's places go to the training log.
  const itinerary: Itinerary = structuredClone(it);
  const { votes: afterDays, replaced } = retireVotes(row, dayIdx.flatMap((di) => it.days[di]!.stops.map((_, si) => `${di}-${si}`)), itinerary);
  const votes: TripRow["votes"] = Object.fromEntries(Object.entries(afterDays).filter(([k]) => !k.startsWith("h-")));
  const kept = (it.hotels ?? []).map((h, i) => ({ h, i })).filter(({ h }) => h.city !== old.city);
  const firstOld = (it.hotels ?? []).findIndex((h) => h.city === old.city);
  const at = firstOld >= 0 ? kept.filter(({ i }) => i < firstOld).length : kept.length;
  const hotelList = [...kept.slice(0, at), ...newHotels.map((h) => ({ h, i: -1 })), ...kept.slice(at)];
  hotelList.forEach(({ i }, j) => {
    const v = i >= 0 ? row.votes?.[`h-${i}`] : undefined;
    if (v) votes[`h-${j}`] = v;
  });
  for (const { h, i } of (it.hotels ?? []).map((h, i) => ({ h, i })).filter(({ h }) => h.city === old.city)) {
    const v = row.votes?.[`h-${i}`];
    if (v) replaced.push({ source: h.source, vote: v });
  }
  itinerary.replaced = replaced.slice(-200);
  itinerary.hotels = hotelList.map(({ h }) => h);
  dayIdx.forEach((di, k) => (itinerary.days[di] = newDays[k]!));
  const nextFirst = next ? itinerary.days.findIndex((d) => d.city === next.city) : -1;
  if (next && nextFirst >= 0 && leg.nextTransfer) itinerary.days[nextFirst] = { ...itinerary.days[nextFirst]!, arrival: arrivalText(city, leg.nextTransfer) };

  const onRoute = new Set([city, ...route.filter((_, i) => i !== legIndex).map((l) => l.city)].map(cityKey));
  const alternatives = [{ city: old.city, why: "Your original pick" }, ...(leg.alternatives ?? [])].filter((a, i, all) => !onRoute.has(cityKey(a.city)) && all.findIndex((b) => sameCity(b.city, a.city)) === i).slice(0, 3);
  itinerary.route = route.map((l, i): RouteLeg => {
    if (i === legIndex) return { city, region: leg.region, days: n, why: leg.why, season: leg.season, alternatives, transfer: prev ? (leg.transfer ?? null) : null, dayThemes: [] };
    if (i === legIndex + 1) return { ...l, transfer: leg.nextTransfer ?? l.transfer ?? null };
    return l;
  });
  if (leg.title) itinerary.title = leg.title;
  // The personal line may have been about the town that's gone.
  if (itinerary.forYou && itinerary.forYou.toLowerCase().includes(old.city.toLowerCase())) itinerary.forYou = "";

  const saved = await updateTrip(row, { itinerary, votes, title: itinerary.title });
  await syncFeedback(saved);
  return friends.credit(saved);
}

export async function setLocked(ctx: Ctx, row: TripRow, day: number, index: number, locked: boolean) {
  if (!row.itinerary.days[day]?.stops[index]) throw new HttpError(404, "That stop isn't in this trip anymore. Reload and try again.");
  const itinerary: Itinerary = structuredClone(row.itinerary);
  itinerary.days[day]!.stops[index]!.locked = locked;
  return saveEdit(row, itinerary, row.votes ?? {});
}
