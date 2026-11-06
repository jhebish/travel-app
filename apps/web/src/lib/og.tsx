/**
 * Link previews: the Open Graph images iMessage, Slack, WhatsApp and X show when someone pastes a
 * Pylos link, and the preview text the pages put next to them.
 *
 * One look everywhere: warm paper, a pistachio arch filled with a faint eight-point-star lattice,
 * Marcellus capitals over EB Garamond, and the Pylos wave along the bottom. Message apps show the
 * card about 300pt wide, so the title is big and the words are few.
 *
 * Satori (next/og) lays out flexbox only: every element with more than one child is display: flex,
 * and SVG children are plain elements (no components or fragments inside <svg>). Text is wrapped
 * here, with widths measured from these fonts, so titles break evenly and cuts land between words.
 */
import { DESTINATION_BY_KEY, monthsLabel, type CommunityTrip, type Destination, type Itinerary } from "@travel/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { Ctx } from "./auth";
import { getCommunityTrip } from "./community";
import { env } from "./env";
import { getSharedTrip } from "./share";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

// Design tokens from globals.css (light theme).
const C = {
  paper: "#f6f0e8",
  surface: "#fffdf9",
  ink: "#3b2d36",
  muted: "#6a5a63",
  line: "#e4d9cc",
  teal: "#3f7472",
  tealSoft: "#cde3e2",
  pistachio: "#d5e4c8",
  pistachioLine: "#b5c8a6",
  olive: "#4f6b47",
  ochre: "#f3e1b6",
  clay: "#f0d5d0",
  clayLine: "#b48a86",
  warm: "#b8924a",
};
/** Pastels the app cycles through for timeline stars and route stops. */
const CYCLE = [C.ochre, C.clay, C.tealSoft];

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------
/**
 * Fontsource 5.1.0 WOFF subsets (Satori can't read WOFF2): Latin, plus Latin Extended and
 * Vietnamese so names like Wrocław, Kuşadası or Hội An keep their accents. The extra subsets are
 * separate families listed after the main one, so a missing character falls back to the same face.
 * Read from disk at request time; next.config.mjs traces the folder into the image functions.
 */
const FONT_FILES: [name: string, file: string, style: "normal" | "italic"][] = [
  ["Marcellus", "marcellus-latin-400-normal.woff", "normal"],
  ["Marcellus Ext", "marcellus-latin-ext-400-normal.woff", "normal"],
  ["EB Garamond", "eb-garamond-latin-400-normal.woff", "normal"],
  ["EB Garamond", "eb-garamond-latin-400-italic.woff", "italic"],
  ["EB Garamond Ext", "eb-garamond-latin-ext-400-normal.woff", "normal"],
  ["EB Garamond Ext", "eb-garamond-latin-ext-400-italic.woff", "italic"],
  ["EB Garamond Vi", "eb-garamond-vietnamese-400-normal.woff", "normal"],
  ["EB Garamond Vi", "eb-garamond-vietnamese-400-italic.woff", "italic"],
];
const DISPLAY = "Marcellus, Marcellus Ext, EB Garamond, EB Garamond Ext, EB Garamond Vi";
const BODY = "EB Garamond, EB Garamond Ext, EB Garamond Vi";

type OgFont = { name: string; data: Buffer; weight: 400; style: "normal" | "italic" };
let fontsP: Promise<OgFont[]> | null = null;
/** Loaded once per server instance; passing the same array lets Satori reuse its parsed fonts too. */
function fonts(): Promise<OgFont[]> {
  if (!fontsP) {
    const p = Promise.all(
      FONT_FILES.map(async ([name, file, style]) => ({
        name,
        style,
        weight: 400 as const,
        data: await readFile(join(process.cwd(), "src", "app", "og", "fonts", file)),
      })),
    );
    p.catch(() => {
      if (fontsP === p) fontsP = null; // try again on the next request
    });
    fontsP = p;
  }
  return fontsP;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
/** Trips get edited, so their cards refresh hourly; the stand-in for a missing trip is kept briefly. */
const CACHE = {
  trip: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
  brief: "public, max-age=300, s-maxage=300",
  static: "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
} as const;
type CacheKind = keyof typeof CACHE;

async function png(element: ReactElement, cache: CacheKind): Promise<ImageResponse> {
  let list: OgFont[] | undefined;
  try {
    list = await fonts();
  } catch (e) {
    // Still answer with a picture (Satori's built-in sans) rather than a broken preview.
    console.error("og: fonts failed to load", (e as Error).message);
  }
  return new ImageResponse(element, { ...OG_SIZE, fonts: list, headers: { "cache-control": CACHE[cache] } });
}

// ---------------------------------------------------------------------------
// Data → images
// ---------------------------------------------------------------------------
export interface TripPreview {
  /** City or country for the eyebrow: "Egypt", "Lisbon". */
  place: string;
  title: string;
  summary: string;
  days: number;
  /** Multi-city route (two or more stops), else empty. */
  legs: { city: string; days: number }[];
  /** The first day themes, shown for one-place trips. */
  themes: string[];
}

/** What a card shows of a trip. Tolerates older or partial saved itineraries. */
export function tripPreview(destination: string, title: string, it: Itinerary): TripPreview {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const dest = text(destination);
  const days = Array.isArray(it.days) ? it.days : [];
  const legs = (Array.isArray(it.route) ? it.route : []).filter((l) => text(l?.city)).map((l) => ({ city: text(l.city), days: Number(l.days) || 1 }));
  return {
    place: text(dest.split(",")[0]) || dest,
    title: text(it.title) || text(title) || "A trip on Pylos",
    summary: text(it.summary),
    days: days.length,
    legs: legs.length > 1 ? legs : [],
    themes: days
      .slice(0, 3)
      .map((d) => text(d?.theme))
      .filter(Boolean),
  };
}

/** A trip's card. No trip (unknown, unshared, private) gets the brand card, so nothing leaks. */
export function tripImage(t: TripPreview | null): Promise<ImageResponse> {
  return t ? png(<TripCard t={t} />, "trip") : brandImage("brief");
}

const previewOrNull = (t: { destination: string; title: string; itinerary?: Itinerary } | null) => {
  try {
    return t?.itinerary ? tripPreview(t.destination, t.title, t.itinerary) : null;
  } catch (e) {
    console.error("og: unreadable itinerary", (e as Error).message.slice(0, 80));
    return null;
  }
};

export async function sharedTripImage(token: string): Promise<ImageResponse> {
  const t = await getSharedTrip(token).catch((e: Error) => {
    console.error("og: shared trip lookup failed", e.message.slice(0, 80));
    return null;
  });
  return tripImage(previewOrNull(t));
}

/** Community trips: public ones only, whoever is asking. */
export async function communityTripImage(id: string): Promise<ImageResponse> {
  return tripImage(previewOrNull(await publicCommunityTrip(id)));
}

export function destinationImage(key: string): Promise<ImageResponse> {
  const d = DESTINATION_BY_KEY[key];
  return d ? png(<DestinationCard d={d} />, "static") : brandImage("brief");
}

export function brandImage(cache: CacheKind = "static"): Promise<ImageResponse> {
  return png(<BrandCard />, cache);
}

let anon: SupabaseClient | null = null;
/**
 * A community trip as a signed-out visitor sees it (public trips only), for link previews.
 * Same visibility rules as /api/community/trips/[id]; any error reads as "no preview".
 */
export async function publicCommunityTrip(id: string): Promise<CommunityTrip | null> {
  try {
    anon ??= createClient(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const visitor: Ctx = { user: null, db: anon, role: "traveler" };
    return await getCommunityTrip(visitor, id);
  } catch (e) {
    console.error("og: community trip lookup failed", (e as Error).message.slice(0, 80));
    return null;
  }
}

/** Preview text: "7 days in Egypt: Cairo's bazaars and pyramids, then…", at most `max` characters. */
export function linkDescription(days: number, destination: string, summary: string, max = 160): string {
  const lead = days > 0 ? `${days} ${days === 1 ? "day" : "days"} in ${destination.trim()}` : destination.trim();
  const body = squash(summary);
  return clip(body ? `${lead}: ${body}` : lead, max);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const ELLIPSIS = "…";
/** Drop trailing punctuation before an ellipsis. */
const trail = (s: string) => s.replace(/[\s,;:.·–—-]+$/u, "");

/** Cut to `max` characters at a word boundary, ending with an ellipsis. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${trail(space > max * 0.6 ? cut.slice(0, space) : cut)}${ELLIPSIS}`;
}

// ---------------------------------------------------------------------------
// Measuring and wrapping
// ---------------------------------------------------------------------------
type Face = "display" | "body" | "italic";
/** Average advances in ems by character class, measured on these exact font files. */
const ADVANCE: Record<Face, { narrow: number; space: number; lower: number; wide: number; upper: number; upperWide: number; digit: number }> = {
  display: { narrow: 0.29, space: 0.3, lower: 0.54, wide: 0.82, upper: 0.61, upperWide: 1.02, digit: 0.54 },
  body: { narrow: 0.27, space: 0.2, lower: 0.46, wide: 0.74, upper: 0.64, upperWide: 0.91, digit: 0.48 },
  italic: { narrow: 0.27, space: 0.2, lower: 0.43, wide: 0.71, upper: 0.62, upperWide: 1.03, digit: 0.48 },
};
const NARROW = new Set("fijlrtI.,;:'’‘!|()[]-·");

/** Estimated width in px. Characters outside Latin (CJK, Arabic…) count as a full em, to be safe. */
function measure(s: string, size: number, face: Face, tracking = 0): number {
  const a = ADVANCE[face];
  let em = 0;
  let n = 0;
  for (const ch of s) {
    n++;
    const code = ch.codePointAt(0)!;
    if (ch === " ") em += a.space;
    else if (NARROW.has(ch)) em += a.narrow;
    else if (ch === "m" || ch === "w") em += a.wide;
    else if (ch === "M" || ch === "W") em += a.upperWide;
    else if (code >= 48 && code <= 57) em += a.digit;
    else if (code > 0x24f && (code < 0x1e00 || code > 0x1eff) && (code < 0x2000 || code > 0x206f)) em += 1;
    else em += ch !== ch.toLowerCase() ? a.upper : a.lower;
  }
  return em * size + n * tracking;
}

type Fit = { size: number; face: Face; width: number; tracking?: number };
const fitsIn = (s: string, f: Fit) => measure(s, f.size, f.face, f.tracking) <= f.width;

/** Greedy word wrap; a word wider than the line is broken between characters. */
function wrap(text: string, f: Fit): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of squash(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (fitsIn(next, f)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (!fitsIn(line, f) && [...line].length > 1) {
      const chars = [...line];
      let k = chars.length - 1;
      while (k > 1 && !fitsIn(chars.slice(0, k).join(""), f)) k--;
      lines.push(chars.slice(0, k).join(""));
      line = chars.slice(k).join("");
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** At most `max` lines; if the text runs longer, the last line ends at a word with an ellipsis. */
function fitLines(text: string, f: Fit, max: number): string[] {
  const lines = wrap(text, f);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const words = kept[max - 1]!.split(" ");
  for (let n = words.length; n >= 1; n--) {
    const last = `${trail(words.slice(0, n).join(" "))}${ELLIPSIS}`;
    if (fitsIn(last, f)) return [...kept.slice(0, max - 1), last];
  }
  return [...kept.slice(0, max - 1), `${trail([...kept[max - 1]!].slice(0, -2).join(""))}${ELLIPSIS}`];
}

/** Even line breaks for a title already known to need `n` (≤ 3) lines: the narrowest widest line. */
function balance(text: string, n: number, f: Fit): string[] {
  const words = squash(text).split(" ");
  if (n <= 1 || words.length < n || n > 3) return wrap(text, f);
  const w = (from: number, to: number) => measure(words.slice(from, to).join(" "), f.size, f.face, f.tracking);
  let best: number[] = [];
  let bestCost = Infinity;
  const cuts = n === 2 ? words.map((_, i) => [i]).slice(1) : words.flatMap((_, i) => words.map((__, j) => [i, j])).filter(([i, j]) => i! > 0 && j! > i! && j! < words.length);
  for (const c of cuts) {
    const edges = [0, ...c, words.length];
    const widths = edges.slice(1).map((end, k) => w(edges[k]!, end));
    // Narrowest longest line wins; on a tie, the longer first line (classic top-heavy setting).
    const cost = Math.max(...widths) - widths[0]! * 1e-6;
    if (Math.max(...widths) <= f.width && cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  if (!best.length) return wrap(text, f);
  const edges = [0, ...best, words.length];
  return edges.slice(1).map((end, k) => words.slice(edges[k]!, end).join(" "));
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
const W = OG_SIZE.width;
const H = OG_SIZE.height;
const MARGIN = 76;
/** The text column, left of the arch. Content is centred in it and budgeted to fit. */
const COL = { x: MARGIN, y: 52, w: 650, h: 492 };
/** Width estimates land within about ±7% of the real text; the gutter before the arch absorbs the rest. */
const LINE_W = COL.w;
/** The arch stands on the footer's wave. */
const ARCH = { x: 800, y: 46, w: 336, h: 504 };
const FOOT = { y: 566, h: 40 };

const EYEBROW = { size: 30, tracking: 4, h: 36 };
const TITLE = { gap: 14, leading: 1.06, sizes: [104, 92, 80, 68, 58, 52] };
const SUMMARY = { size: 34, leading: 1.28, gap: 16, lines: 2 };

function Frame({ art, children }: { art: ReactElement; children: ReactNode }) {
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", backgroundColor: C.paper, fontFamily: BODY, color: C.ink }}>
      <div style={{ position: "absolute", left: ARCH.x, top: ARCH.y, width: ARCH.w, height: ARCH.h, display: "flex" }}>{art}</div>
      <div
        style={{
          position: "absolute",
          left: COL.x,
          top: COL.y,
          width: COL.w,
          height: COL.h,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
      <Footer />
    </div>
  );
}

function Footer() {
  const word = 118; // "PYLOS" at 30px, tracked
  const site = 82; // "pylos.ai" at 28px italic
  const gap = 28;
  return (
    <div style={{ position: "absolute", left: MARGIN, top: FOOT.y, width: W - MARGIN * 2, height: FOOT.h, display: "flex", alignItems: "center" }}>
      <div style={{ width: word, fontFamily: DISPLAY, fontSize: 30, letterSpacing: 6, color: C.ink }}>PYLOS</div>
      <div style={{ display: "flex", marginLeft: gap, marginRight: gap }}>{wave(W - MARGIN * 2 - word - site - gap * 2)}</div>
      <div style={{ width: site, display: "flex", justifyContent: "flex-end", fontStyle: "italic", fontSize: 28, color: C.muted }}>pylos.ai</div>
    </div>
  );
}

/** Text set line by line, as wrapped above. */
function Lines({ lines, style, lineStyle }: { lines: string[]; style?: CSSProperties; lineStyle: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, ...style }}>
      {lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: "nowrap", ...lineStyle }}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** "EGYPT · 3 STOPS · 7 DAYS": drops middle parts, then shortens the first, until it fits on a line. */
function eyebrowText(parts: string[]): string {
  const f: Fit = { size: EYEBROW.size, face: "display", width: LINE_W, tracking: EYEBROW.tracking };
  const list = parts.filter(Boolean).map((p) => p.toUpperCase());
  const last = list[list.length - 1] ?? "";
  for (let keep = list.length - 1; keep >= 1; keep--) {
    const s = [...list.slice(0, keep), last].join(" · ");
    if (fitsIn(s, f)) return s;
  }
  if (list.length < 2 || !fitsIn(last, f)) return fitLines(list.join(" · "), f, 1)[0] ?? "";
  return `${fitLines(list[0]!, { ...f, width: f.width - measure(` · ${last}`, f.size, f.face, f.tracking) }, 1)[0]} · ${last}`;
}

function Eyebrow({ children }: { children: string }) {
  return (
    <div style={{ flexShrink: 0, height: EYEBROW.h, fontFamily: DISPLAY, fontSize: EYEBROW.size, lineHeight: 1.2, letterSpacing: EYEBROW.tracking, color: C.teal, whiteSpace: "nowrap" }}>
      {children}
    </div>
  );
}

/**
 * The largest Marcellus size at which the title fits the height left over: two lines at display
 * sizes, three when smaller. Lines are balanced; past the smallest size the title ends in an ellipsis.
 */
function fitTitle(text: string, budget: number, sizes = TITLE.sizes) {
  const maxLines = (size: number) => Math.min(size >= 80 ? 2 : 3, Math.floor(budget / (size * TITLE.leading)));
  for (const size of sizes) {
    const f: Fit = { size, face: "display", width: LINE_W };
    const n = wrap(text, f).length;
    if (n <= maxLines(size)) return { size, lines: balance(text, n, f) };
  }
  const size = sizes[sizes.length - 1]!;
  return { size, lines: fitLines(text, { size, face: "display", width: LINE_W }, Math.max(1, maxLines(size))) };
}

function Title({ t }: { t: ReturnType<typeof fitTitle> }) {
  return (
    <Lines
      lines={t.lines}
      style={{ marginTop: TITLE.gap }}
      lineStyle={{ fontFamily: DISPLAY, fontSize: t.size, lineHeight: TITLE.leading, letterSpacing: -0.5, color: C.ink }}
    />
  );
}

/** Two lines at most: the whole summary, else its first sentence, else a cut at a word. */
function summaryLines(text: string): string[] {
  const f: Fit = { size: SUMMARY.size, face: "italic", width: LINE_W };
  const all = wrap(text, f);
  if (all.length <= SUMMARY.lines) return all;
  const first = squash(text).match(/^.+?[.!?](?=\s|$)/)?.[0];
  const firstLines = first ? wrap(first, f) : [];
  if (first && firstLines.length <= SUMMARY.lines) return firstLines;
  return fitLines(text, f, SUMMARY.lines);
}

const summaryHeight = (lines: string[]) => (lines.length ? SUMMARY.gap + lines.length * SUMMARY.size * SUMMARY.leading : 0);

function Summary({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <Lines
      lines={lines}
      style={{ marginTop: SUMMARY.gap }}
      lineStyle={{ fontStyle: "italic", fontSize: SUMMARY.size, lineHeight: SUMMARY.leading, color: C.muted }}
    />
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
function TripCard({ t }: { t: TripPreview }) {
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  const eyebrow = eyebrowText([t.place, t.legs.length > 1 ? plural(t.legs.length, "stop") : "", t.days ? plural(t.days, "day") : ""]);
  const summary = t.summary ? summaryLines(t.summary) : [];
  const route = t.legs.length > 1 ? fitRoute(t.legs) : null;
  const themes = route ? [] : t.themes;
  const extra = route ? ROUTE_GAP + route.tier.h : themes.length ? THEMES_GAP + themes.length * THEME_ROW : 0;
  const title = fitTitle(t.title, COL.h - EYEBROW.h - TITLE.gap - summaryHeight(summary) - extra);
  return (
    <Frame art={arch({ center: "star" })}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Title t={title} />
      <Summary lines={summary} />
      {route ? <Route fit={route} /> : themes.length ? <Themes themes={themes} /> : null}
    </Frame>
  );
}

function DestinationCard({ d }: { d: Destination }) {
  const kind = d.kind === "region" ? "route" : "trip";
  const eyebrow = d.country === d.name ? `SAMPLE ${d.sampleDays}-DAY ${kind.toUpperCase()}` : eyebrowText([d.country, `${d.sampleDays}-day ${kind}`]);
  const summary = summaryLines(d.blurb);
  const season = monthsLabel(d.bestMonths);
  const badges = season || d.trend;
  const title = fitTitle(d.name, COL.h - EYEBROW.h - TITLE.gap - summaryHeight(summary) - (badges ? BADGE_GAP + BADGE_H : 0), [124, 110, 96, 84, 72, 60]);
  return (
    <Frame art={arch({ center: "star", star: C.clay })}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Title t={title} />
      <Summary lines={summary} />
      {badges ? (
        <div style={{ display: "flex", flexShrink: 0, marginTop: BADGE_GAP }}>
          {season ? <Badge bg={C.pistachio} color={C.olive}>{`Best ${season}`}</Badge> : null}
          {d.trend ? (
            <Badge bg={C.ochre} color={C.ink} star>
              Trending 2026
            </Badge>
          ) : null}
        </div>
      ) : null}
    </Frame>
  );
}

function BrandCard() {
  return (
    <Frame art={arch({ center: "globe" })}>
      <Title t={{ size: 112, lines: ["Where to", "next?"] }} />
      <div style={{ flexShrink: 0, marginTop: 24, fontStyle: "italic", fontSize: 44, lineHeight: 1.2, color: C.muted }}>Trips planned the local way</div>
    </Frame>
  );
}

const BADGE_GAP = 30;
const BADGE_H = 50;

function Badge({ bg, color, star, children }: { bg: string; color: string; star?: boolean; children: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", height: BADGE_H, padding: "0 24px", marginRight: 14, borderRadius: BADGE_H / 2, backgroundColor: bg, color, fontSize: 28 }}>
      {star ? (
        <svg width="22" height="22" viewBox="0 0 22 22" style={{ marginRight: 10 }}>
          <path d={octagram(11, 11, 10)} fill={C.warm} />
        </svg>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

// Multi-city route: arch-topped stops, "Cairo 3 days → Luxor 2 → Aswan 2".
const ROUTE_GAP = 30;
const ROUTE_TIERS = [
  { city: 30, note: 26, padX: 22, gap: 10, arrow: 30, arrowGap: 8, h: 60 },
  { city: 26, note: 22, padX: 16, gap: 8, arrow: 22, arrowGap: 7, h: 52 },
];
type Tier = (typeof ROUTE_TIERS)[number];
type Leg = { city: string; days: number };

/** The largest chips that put every stop on one line; if none do, the small ones and "+N". */
function fitRoute(legs: Leg[]) {
  // Long names are shortened so that at least two stops always fit.
  const name = (s: string) => fitLines(s, { size: 30, face: "display", width: 220 }, 1)[0]!;
  const note = (l: Leg, i: number) => (i === 0 ? `${l.days} ${l.days === 1 ? "day" : "days"}` : `${l.days}`);
  const chip = (tier: Tier, city: string, n: string) => tier.padX * 2 + (city ? measure(city, tier.city, "display") + tier.gap : 0) + measure(n, tier.note, "italic") + 4;
  const hop = (tier: Tier) => tier.arrow + tier.arrowGap * 2;
  const width = (tier: Tier, shown: number) =>
    legs.slice(0, shown).reduce((w, l, i) => w + chip(tier, name(l.city), note(l, i)) + (i ? hop(tier) : 0), 0) +
    (shown < legs.length ? hop(tier) + chip(tier, "", `+${legs.length - shown}`) : 0);
  const tier = ROUTE_TIERS.find((t) => width(t, legs.length) <= COL.w) ?? ROUTE_TIERS[ROUTE_TIERS.length - 1]!;
  let shown = legs.length;
  while (shown > 2 && width(tier, shown) > COL.w) shown--;
  return { tier, stops: legs.slice(0, shown).map((l, i) => ({ city: name(l.city), note: note(l, i) })), more: legs.length - shown };
}

function Route({ fit }: { fit: ReturnType<typeof fitRoute> }) {
  const { tier } = fit;
  return (
    <div style={{ display: "flex", flexShrink: 0, alignItems: "center", marginTop: ROUTE_GAP }}>
      {fit.stops.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          {i > 0 ? arrow(tier) : null}
          <Chip tier={tier} bg={CYCLE[i % CYCLE.length]!} title={s.city} note={s.note} />
        </div>
      ))}
      {fit.more > 0 ? (
        <div style={{ display: "flex", alignItems: "center" }}>
          {arrow(tier)}
          <Chip tier={tier} bg={C.surface} title="" note={`+${fit.more}`} />
        </div>
      ) : null}
    </div>
  );
}

function Chip({ tier, bg, title, note }: { tier: Tier; bg: string; title: string; note: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        height: tier.h,
        padding: `${Math.round(tier.h * 0.23)}px ${tier.padX}px 0`,
        borderTopLeftRadius: tier.h / 2,
        borderTopRightRadius: tier.h / 2,
        borderBottomLeftRadius: 10,
        borderBottomRightRadius: 10,
        backgroundColor: bg,
        border: `1.5px solid ${C.line}`,
        whiteSpace: "nowrap",
      }}
    >
      {title ? <div style={{ fontFamily: DISPLAY, fontSize: tier.city, color: C.ink, marginRight: tier.gap }}>{title}</div> : null}
      <div style={{ fontStyle: "italic", fontSize: tier.note, color: C.muted }}>{note}</div>
    </div>
  );
}

function arrow(tier: Tier) {
  const w = tier.arrow;
  return (
    <svg width={w} height="14" viewBox={`0 0 ${w} 14`} style={{ margin: `0 ${tier.arrowGap}px` }}>
      <path d={`M1 7h${w - 3}M${w - 8} 2l6 5-6 5`} fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// One-place trips: the first days, "Day 1 · Tascas and tiles".
const THEMES_GAP = 26;
const THEME_ROW = 44;

function Themes({ themes }: { themes: string[] }) {
  const label = 84; // a fixed width, so the themes line up
  const dot = 28;
  const f: Fit = { size: 30, face: "body", width: COL.w - 26 - 16 - label - dot };
  return (
    <div style={{ display: "flex", flexShrink: 0, flexDirection: "column", marginTop: THEMES_GAP }}>
      {themes.map((theme, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", height: THEME_ROW }}>
          <svg width="26" height="26" viewBox="0 0 26 26">
            <path d={octagram(13, 13, 12)} fill={CYCLE[i % CYCLE.length]} stroke={C.clayLine} strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <div style={{ width: label, marginLeft: 16, fontFamily: DISPLAY, fontSize: 22, letterSpacing: 3, color: C.teal }}>{`DAY ${i + 1}`}</div>
          <div style={{ width: dot, display: "flex", justifyContent: "center", fontSize: 30, color: C.muted }}>·</div>
          <div style={{ fontSize: 30, color: C.ink, whiteSpace: "nowrap" }}>{fitLines(theme, f, 1)[0]}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motifs (plain SVG)
// ---------------------------------------------------------------------------
/** An eight-point star's outline: two overlapping squares, one turned 45°. Inner corners sit at r·√(2−√2). */
function octagramPoints(cx: number, cy: number, r: number): [number, number][] {
  const inner = r * Math.sqrt(2 - Math.SQRT2);
  return Array.from({ length: 16 }, (_, k) => {
    const a = (k * Math.PI) / 8 - Math.PI / 2;
    const rad = k % 2 ? inner : r;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  });
}

function octagram(cx: number, cy: number, r: number): string {
  return `M${octagramPoints(cx, cy, r)
    .map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`)
    .join("L")}Z`;
}

/** Distance from a point to a polygon's outline (negative inside). */
function polygonDistance(x: number, y: number, pts: [number, number][]): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy)));
    d = Math.min(d, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
  }
  return inside ? -d : d;
}

/** The Pylos wave (a Vitruvian scroll): the 28×12 tile from `.meander` in globals.css. */
const WAVE_TILE =
  "M0 11 C6 11 8 9 8 6 C8 3 10.5 1 14 1 C17.5 1 19.5 3 19.5 5.2 C19.5 8 22.5 11 28 11 M19.5 5.2 C19.5 7.2 18 8.2 16.4 8.2 C15 8.2 14.2 7.3 14.2 6.2 C14.2 5.2 15 4.6 15.9 4.6";

function wave(width: number, scale = 2) {
  const n = Math.ceil(width / (28 * scale));
  return (
    <svg width={width} height={12 * scale} viewBox={`0 0 ${width / scale} 12`}>
      <g fill="none" stroke={C.teal} strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.8">
        {Array.from({ length: n }, (_, i) => (
          <path key={i} d={WAVE_TILE} transform={`translate(${i * 28} 0)`} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The tall pistachio arch: a white inner line, a lattice of small eight-point stars (whole ones
 * only, clear of the edges and of the centrepiece), and a rose-window star or a globe under the curve.
 */
function arch({ center, star = C.ochre }: { center: "star" | "globe"; star?: string }) {
  const { w, h } = ARCH;
  const r = w / 2;
  const shape = (i: number) => `M${i} ${h} V${r} A${r - i} ${r - i} 0 0 1 ${w - i} ${r} V${h} Z`;
  const inset = 14;
  const cx = r;
  const cy = r + 6;
  const big = center === "star" ? 88 : 116;
  const step = 44;
  const half = 7.5;
  const reach = half * Math.SQRT2;
  const pad = inset + reach + 8;
  const piece = octagramPoints(cx, cy, big);
  const clear = (x: number, y: number) =>
    center === "star" ? polygonDistance(x, y, piece) >= reach + 10 : Math.hypot(x - cx, y - cy) >= big + reach + 10;
  const q = (n: number) => +n.toFixed(2);
  let lattice = "";
  for (let y = cy - Math.floor((cy - pad) / step) * step; y <= h - reach - 6; y += step) {
    for (let x = cx - Math.floor((cx - pad) / step) * step; x <= w - pad; x += step) {
      if (y < r && Math.hypot(x - r, y - r) > r - pad) continue;
      if (!clear(x, y)) continue;
      lattice += `M${q(x - half)} ${q(y - half)}h${half * 2}v${half * 2}h${-half * 2}Z`;
      lattice += `M${q(x)} ${q(y - reach)}L${q(x + reach)} ${q(y)}L${q(x)} ${q(y + reach)}L${q(x - reach)} ${q(y)}Z`;
    }
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={shape(0)} fill={C.pistachio} stroke={C.pistachioLine} strokeWidth="2" />
      <path d={shape(inset)} fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2" />
      <path d={lattice} fill="none" stroke="#ffffff" strokeOpacity="0.62" strokeWidth="1.5" strokeLinejoin="round" />
      {center === "star" ? (
        <g>
          <path d={octagram(cx, cy, big)} fill={star} stroke={C.warm} strokeOpacity="0.55" strokeWidth="2" strokeLinejoin="round" />
          <path d={octagram(cx, cy, big * 0.62)} fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2" strokeLinejoin="round" />
          <circle cx={cx} cy={cy} r="9" fill={C.teal} />
        </g>
      ) : (
        globe(cx, cy, big)
      )}
    </svg>
  );
}

/** A small globe with a few destination pins, for the brand card. */
function globe(cx: number, cy: number, R: number) {
  const pins: [number, number, string, number][] = [
    [-0.42, -0.3, C.clay, 12],
    [0.16, -0.06, C.ochre, 16],
    [0.52, 0.34, C.clay, 12],
    [-0.14, 0.5, C.clay, 12],
  ];
  return (
    <g>
      <circle cx={cx} cy={cy} r={R} fill={C.tealSoft} stroke={C.teal} strokeWidth="2.5" />
      <g fill="none" stroke={C.teal} strokeOpacity="0.55" strokeWidth="1.6">
        <ellipse cx={cx} cy={cy} rx={R * 0.5} ry={R} />
        <ellipse cx={cx} cy={cy} rx={R * 0.866} ry={R} />
        <path d={`M${cx} ${cy - R}V${cy + R}M${cx - R} ${cy}H${cx + R}`} />
        <path d={`M${cx - R * 0.866} ${cy - R / 2}H${cx + R * 0.866}M${cx - R * 0.866} ${cy + R / 2}H${cx + R * 0.866}`} />
      </g>
      {pins.map(([x, y, fill, size], i) => (
        <path key={i} d={octagram(cx + x * R, cy + y * R, size)} fill={fill} stroke={C.ink} strokeWidth="1.6" strokeLinejoin="round" />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Apple touch icon
// ---------------------------------------------------------------------------
export const ICON_SIZE = { width: 180, height: 180 };

/** The Pylos star on teal: the home-screen icon, and the site icon message apps show. */
export function appleIconImage(): ImageResponse {
  const s = ICON_SIZE.width;
  const c = s / 2;
  return new ImageResponse(
    (
      <div style={{ width: s, height: s, display: "flex", backgroundColor: C.teal }}>
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <path d={octagram(c, c, 66)} fill={C.paper} />
          <path d={octagram(c, c, 41)} fill="none" stroke={C.teal} strokeWidth="5" strokeLinejoin="round" />
          <circle cx={c} cy={c} r="9" fill={C.teal} />
        </svg>
      </div>
    ),
    { ...ICON_SIZE, headers: { "cache-control": CACHE.static } },
  );
}
