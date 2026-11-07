import Anthropic from "@anthropic-ai/sdk";
import {
  NIGHT_SPOTS_TOOL,
  NightPulseSchema,
  NightSpotsSchema,
  buildNightPulsePrompt,
  buildPulse,
  checkEvidence,
  pulseIsFresh,
  type NightPulse,
  type NightSpot,
  type PlaceVerification,
  type SearchResult,
} from "@travel/core";
import { anthropicClient } from "./claude";
import { env } from "./env";
import { PlacesError, placesEnabled, verifyPlace } from "./places";
import { supabaseAdmin } from "./supabase/server";

/**
 * The night pulse for a city (see packages/core/src/nightpulse.ts): researched with Claude's web
 * search at most once a month per city, checked against the pages the search really returned,
 * confirmed on Google Maps, and cached for everyone in places_cache.
 */

/** What was typed, normalized: "Lisbon, Portugal" and "lisbon portugal" share a pulse. */
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const pulseKey = (city: string) => `nightpulse1:${words(city)}`;
const lockKey = (city: string) => `nightpulse1-lock:${words(city)}`;

/** A city name safe to quote in a prompt: one line, no quotes, brackets or control characters. */
const asPlaceName = (s: string) =>
  s
    .replace(/[\p{Cc}"“”„«»`<>{}[\]\\]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/** The cached pulse for a city, fresh or not (null if none). */
async function readStored(city: string): Promise<NightPulse | null> {
  const { data } = await supabaseAdmin().from("places_cache").select("data").eq("key", pulseKey(city)).maybeSingle();
  if (!data) return null;
  const ok = NightPulseSchema.safeParse(data.data);
  return ok.success ? ok.data : null;
}

/** A fresh pulse for a city from the cache, or null. Never researches. */
export async function readPulse(city: string): Promise<NightPulse | null> {
  const p = await readStored(asPlaceName(city)).catch(() => null);
  return p && pulseIsFresh(p) ? p : null;
}

// ---------------------------------------------------------------------------
// Research: Claude with web search
// ---------------------------------------------------------------------------

const WEB_SEARCH = { type: "web_search_20250305", name: "web_search", max_uses: 6 } as const;
const SYSTEM = `You research nightlife for a travel app: which bars and clubs in a city people go to now, from recent sources you find with web search. You never invent places, sources or URLs. You finish by calling ${NIGHT_SPOTS_TOOL.name} exactly once.`;

type Block = { type: string; [k: string]: unknown };

/** The pages a response's web searches returned. */
function searchResults(content: Block[]): SearchResult[] {
  const out: SearchResult[] = [];
  for (const b of content) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const r of b.content as Block[]) {
      if (r.type === "web_search_result" && typeof r.url === "string") {
        out.push({ url: r.url, title: typeof r.title === "string" ? r.title : undefined, pageAge: typeof r.page_age === "string" ? r.page_age : null });
      }
    }
  }
  return out;
}

/**
 * Ask Claude, with web search, for the city's bars and clubs of the moment. Returns the spots it
 * listed and every page its searches returned (to check its citations against). The search runs
 * on Anthropic's side; a long one pauses ("pause_turn") and is resumed here.
 */
export async function researchNightlife(city: string, deadline: number): Promise<{ spots: NightSpot[]; results: SearchResult[] }> {
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: buildNightPulsePrompt(city) }];
  const results: SearchResult[] = [];
  let force = false;
  for (let turn = 0; turn < 4; turn++) {
    const left = deadline - Date.now();
    if (left < 10_000) break;
    const t0 = Date.now();
    const res = (await anthropicClient().messages.create(
      {
        model: env.claudeModel(),
        max_tokens: 6000,
        system: SYSTEM,
        // The SDK in use predates server tools: the request is passed through as written.
        tools: [WEB_SEARCH, NIGHT_SPOTS_TOOL] as unknown as Anthropic.Tool[],
        tool_choice: force ? { type: "tool", name: NIGHT_SPOTS_TOOL.name } : { type: "auto" },
        messages: messages as Anthropic.MessageParam[],
      },
      { timeout: Math.min(100_000, left), maxRetries: 0 },
    )) as unknown as { content: Block[]; stop_reason: string; usage?: { output_tokens?: number; server_tool_use?: { web_search_requests?: number } } };
    const found = searchResults(res.content);
    results.push(...found);
    console.log(
      `[nightpulse] ${city} turn ${turn + 1}: ${Date.now() - t0}ms, ${res.usage?.server_tool_use?.web_search_requests ?? 0} searches, ${found.length} results, stop=${res.stop_reason}`,
    );
    const call = res.content.find((b) => b.type === "tool_use" && b.name === NIGHT_SPOTS_TOOL.name);
    if (call) {
      const parsed = NightSpotsSchema.safeParse(call.input);
      if (!parsed.success) throw new Error(`night spots failed validation: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
      return { spots: parsed.data.spots, results };
    }
    messages.push({ role: "assistant", content: res.content });
    // A paused search resumes where it was; an answer in plain text is asked for again, as the tool call.
    if (res.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: `Now call ${NIGHT_SPOTS_TOOL.name} with what you found.` });
      force = true;
    }
  }
  throw new Error("night pulse research ran out of time");
}

/** Google's details for each spot (open, where, photos), four lookups at a time. Closed places are left out. */
async function onGoogle(spots: NightSpot[], city: string): Promise<(NightSpot & { place?: PlaceVerification })[]> {
  const out: (NightSpot & { place?: PlaceVerification })[] = [];
  const queue = [...spots];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const s = queue.shift()!;
        try {
          const v = await verifyPlace(s.name, s.neighborhood, city);
          if (v?.status && v.status !== "OPERATIONAL") continue;
          out.push(v ? { ...s, place: v } : s);
        } catch (e) {
          if (!(e instanceof PlacesError)) console.error("[nightpulse] place check failed", s.name, e);
          out.push(s);
        }
      }
    }),
  );
  return out;
}

const inFlight = new Map<string, Promise<NightPulse | null>>();

/**
 * Research a city's pulse and store it. One at a time per city: across servers a short-lived lock
 * row stops a second research while one is running. Returns null when it couldn't be done (no
 * Google check available, too few confirmed places, out of time); nothing is stored then.
 */
async function refresh(city: string, deadline: number): Promise<NightPulse | null> {
  const db = supabaseAdmin();
  const lock = await db.from("places_cache").select("fetched_at").eq("key", lockKey(city)).maybeSingle();
  if (lock.data && Date.now() - Date.parse(lock.data.fetched_at as string) < 3 * 60_000) return null;
  await db.from("places_cache").upsert({ key: lockKey(city), data: {}, fetched_at: new Date().toISOString() });
  try {
    if (!placesEnabled()) return null; // a pulse whose places aren't confirmed on Google isn't worth keeping
    const previous = await readStored(city);
    const { spots, results } = await researchNightlife(city, deadline);
    const checked = checkEvidence(spots, results);
    const located = await onGoogle(checked, city);
    const confirmed = located.filter((s) => s.place).length;
    console.log(`[nightpulse] ${city}: ${spots.length} listed, ${checked.length} with real sources, ${confirmed} on Google`);
    if (confirmed < 3) return null;
    const pulse = buildPulse(city, located, previous);
    const { error } = await db.from("places_cache").upsert({ key: pulseKey(city), data: pulse, fetched_at: pulse.fetchedAt });
    if (error) console.error("[nightpulse] cache write failed", error.code);
    return pulse;
  } catch (e) {
    console.error("[nightpulse] research failed", city, e instanceof Error ? e.message : e);
    return null;
  } finally {
    await db.from("places_cache").delete().eq("key", lockKey(city));
  }
}

/**
 * A city's pulse: the cached one if it's under a month old, otherwise researched now (30–60 s).
 * `deadline` (ms since the epoch) bounds the research. Never throws: null means none for now.
 */
export function nightPulse(cityIn: string, deadline: number): Promise<NightPulse | null> {
  const city = asPlaceName(cityIn);
  if (words(city).length < 2) return Promise.resolve(null);
  const key = pulseKey(city);
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    const stored = await readStored(city).catch(() => null);
    if (stored && pulseIsFresh(stored)) return stored;
    // While a new list can't be made, last month's beats none (but not one from last season).
    const usable = stored && Date.now() - Date.parse(stored.fetchedAt) <= 90 * 864e5 ? stored : null;
    return (await refresh(city, deadline)) ?? usable;
  })()
    .catch(() => null)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
