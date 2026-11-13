/**
 * Pictures for trip pages and the year in travel, in the same look as the link previews in og.tsx:
 *  - a past trip's link preview (/p/[id]), public trips only, like /c/[id];
 *  - "Your 2026 in travel", a 1080×1920 story image of the signed-in person's own year.
 * Satori (next/og) lays out flexbox only: every element with more than one child is display: flex.
 */
import { countryName, SIGNAL_KIND_LABELS, type YearRecap } from "@travel/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ImageResponse } from "next/og";
import type { Ctx } from "./auth";
import { env } from "./env";
import {
  brandImage,
  OG_BADGE_GAP,
  OG_BADGE_H,
  OG_BODY,
  OG_COL,
  OG_COLORS as C,
  OG_DISPLAY,
  OG_EYEBROW,
  OG_TITLE,
  OgBadge,
  OgEyebrow,
  OgFrame,
  OgSummary,
  OgTitle,
  ogArch,
  ogEyebrowText,
  ogFitLines,
  ogFitTitle,
  ogFonts,
  ogMarkSvg,
  ogOctagram,
  ogPng,
  ogSummaryHeight,
  ogSummaryLines,
  ogWave,
} from "./og";
import { getPastTripPage, type PastTripPage, type RecapDTO } from "./pages";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "May 2024", "2024", or "" (no dates, or hidden). */
export function whenLabel(t: { year: number | null; month: number | null }): string {
  if (!t.year) return "";
  return t.month ? `${MONTHS[t.month - 1]} ${t.year}` : String(t.year);
}

let anon: SupabaseClient | null = null;
/** A past trip as a signed-out visitor sees it (Everyone trips only), for link previews. Any error reads as "no preview". */
export async function publicPastTrip(id: string): Promise<PastTripPage | null> {
  try {
    anon ??= createClient(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const visitor: Ctx = { user: null, db: anon, role: "traveler" };
    return await getPastTripPage(visitor, id, { lookups: false });
  } catch (e) {
    console.error("og: past trip lookup failed", (e as Error).message.slice(0, 80));
    return null;
  }
}

/** What a preview says about a past trip: "Kyoto, Japan", "May 2024 · 6 days", and what they loved. */
export function pastTripPreview(p: PastTripPage) {
  const t = p.trip;
  const country = countryName(t.countryCode);
  const when = whenLabel(t);
  const days = t.days ? `${t.days} ${t.days === 1 ? "day" : "days"}` : "";
  const loved = p.loved.slice(0, 4).map((l) => l.name);
  const detail = t.highlights.replace(/\s+/g, " ").trim() || (loved.length ? `Loved ${loved.join(", ")}` : "");
  const first = p.owner?.displayName.split(" ")[0] ?? "";
  const lead = [`${t.city}, ${country}`, when, days].filter(Boolean).join(" · ");
  const description = detail ? `${lead}: ${detail}` : lead;
  return {
    title: first ? `${first} in ${t.city}` : t.city,
    description: description.length > 160 ? `${description.slice(0, 159).replace(/[\s,;:.·–—-]+\S*$/u, "")}…` : description,
    country,
    when,
    days,
    detail,
    first,
  };
}

// ---------------------------------------------------------------------------
// A past trip's link preview, 1200×630
// ---------------------------------------------------------------------------
export async function pastTripImage(id: string): Promise<ImageResponse> {
  const p = await publicPastTrip(id);
  return p ? ogPng(<PastTripCard p={p} />, "trip") : brandImage("brief");
}

function PastTripCard({ p }: { p: PastTripPage }) {
  const v = pastTripPreview(p);
  const eyebrow = ogEyebrowText([v.country, v.when, v.days]);
  const summary = ogSummaryLines(v.detail);
  const badges = [v.first ? `${v.first}'s trip` : "", p.loved.length ? `${p.loved.length} ${p.loved.length === 1 ? "place" : "places"} loved` : ""].filter(Boolean);
  const title = ogFitTitle(p.trip.city, OG_COL.h - OG_EYEBROW.h - OG_TITLE.gap - ogSummaryHeight(summary) - (badges.length ? OG_BADGE_GAP + OG_BADGE_H : 0), [124, 110, 96, 84, 72, 60]);
  return (
    <OgFrame art={ogArch({ center: "star", star: C.clay })}>
      <OgEyebrow>{eyebrow}</OgEyebrow>
      <OgTitle t={title} />
      <OgSummary lines={summary} />
      {badges.length ? (
        <div style={{ display: "flex", flexShrink: 0, marginTop: OG_BADGE_GAP }}>
          {badges.map((b, i) => (
            <OgBadge key={b} bg={i ? C.ochre : C.pistachio} color={i ? C.ink : C.olive} star={i > 0}>
              {b}
            </OgBadge>
          ))}
        </div>
      ) : null}
    </OgFrame>
  );
}

// ---------------------------------------------------------------------------
// "Your 2026 in travel": a story image, 1080×1920
// ---------------------------------------------------------------------------
export const STORY_SIZE = { width: 1080, height: 1920 };
const S = { pad: 96, top: 110 };
const CYCLE = [C.ochre, C.clay, C.tealSoft];

/** The person's own year as a picture. Never cached by anyone else: it's drawn per request for its owner. */
export async function recapStoryImage(dto: RecapDTO): Promise<ImageResponse> {
  let fonts: Awaited<ReturnType<typeof ogFonts>> | undefined;
  try {
    fonts = await ogFonts();
  } catch (e) {
    console.error("og: fonts failed to load", (e as Error).message);
  }
  return new ImageResponse(<Story dto={dto} />, { ...STORY_SIZE, fonts, headers: { "cache-control": "private, no-store" } });
}

function Story({ dto }: { dto: RecapDTO }) {
  const r = dto.recap;
  const w = STORY_SIZE.width - S.pad * 2;
  const left = w - 336 - 40; // beside the arch
  const personality = dto.personality ? ogFitLines(dto.personality, { size: 38, face: "italic", width: left }, 4) : [];
  const tiles: [number | string, string][] = [
    [r.trips, r.trips === 1 ? "trip" : "trips"],
    [r.cities, r.cities === 1 ? "city" : "cities"],
    [r.countries, r.countries === 1 ? "country" : "countries"],
    r.daysAway > 0
      ? [`${r.daysAway}${r.daysUnknown ? "+" : ""}`, r.daysAway === 1 && !r.daysUnknown ? "day away" : "days away"]
      : [r.newCountries.length, r.newCountries.length === 1 ? "new country" : "new countries"],
  ];
  const facts: { label: string; value: string; sub?: string }[] = [];
  if (r.topCity) facts.push({ label: "TOP CITY", value: r.topCity.city, sub: countryName(r.topCity.countryCode) });
  if (r.topPlace) facts.push({ label: "TOP PLACE", value: r.topPlace.name, sub: [SIGNAL_KIND_LABELS[r.topPlace.kind], r.topPlace.city].filter(Boolean).join(" · ") });
  if (r.newCountries.length) facts.push({ label: r.newCountries.length === 1 ? "NEW COUNTRY" : "NEW COUNTRIES", value: r.newCountries.map(countryName).join(", ") });
  const factW = w - 64 - 28;

  return (
    <div style={{ width: STORY_SIZE.width, height: STORY_SIZE.height, display: "flex", flexDirection: "column", position: "relative", backgroundColor: C.paper, color: C.ink, fontFamily: OG_BODY }}>
      <div style={{ position: "absolute", right: S.pad, top: S.top, width: 336, height: 504, display: "flex" }}>{ogArch({ center: "star", star: C.clay })}</div>

      {/* The year */}
      <div style={{ position: "absolute", left: S.pad, top: S.top, width: left, height: 504, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontFamily: OG_DISPLAY, fontSize: 38, letterSpacing: 6, color: C.teal }}>YOUR YEAR IN TRAVEL</div>
        <div style={{ fontFamily: OG_DISPLAY, fontSize: 200, lineHeight: 1, letterSpacing: -2, marginTop: 12 }}>{String(r.year)}</div>
        {personality.length ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
            {personality.map((l, i) => (
              <div key={i} style={{ fontStyle: "italic", fontSize: 38, lineHeight: 1.28, color: C.muted, whiteSpace: "nowrap" }}>
                {l}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* The counts */}
      <div style={{ position: "absolute", left: S.pad, top: S.top + 504 + 64, width: w, display: "flex", flexWrap: "wrap", justifyContent: "space-between" }}>
        {tiles.map(([n, label], i) => (
          <div
            key={label}
            style={{
              width: (w - 28) / 2,
              height: 210,
              marginBottom: 28,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 40px",
              borderRadius: 36,
              backgroundColor: i % 3 === 0 ? C.surface : CYCLE[i % CYCLE.length],
              border: `2px solid ${C.line}`,
            }}
          >
            <div style={{ fontFamily: OG_DISPLAY, fontSize: 112, lineHeight: 1 }}>{String(n)}</div>
            <div style={{ fontSize: 40, color: C.muted, marginTop: 6 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Top city, top place, new countries */}
      <div style={{ position: "absolute", left: S.pad, top: S.top + 504 + 64 + 2 * 238 + 36, width: w, display: "flex", flexDirection: "column" }}>
        {facts.map((f, i) => (
          <div key={f.label} style={{ display: "flex", alignItems: "flex-start", marginBottom: 40 }}>
            <svg width="64" height="64" viewBox="0 0 64 64" style={{ marginTop: 4, marginRight: 28 }}>
              <path d={ogOctagram(32, 32, 28)} fill={CYCLE[i % CYCLE.length]} stroke={C.clayLine} strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", width: factW }}>
              <div style={{ fontFamily: OG_DISPLAY, fontSize: 30, letterSpacing: 5, color: C.teal }}>{f.label}</div>
              <div style={{ fontFamily: OG_DISPLAY, fontSize: 60, lineHeight: 1.12, marginTop: 6, whiteSpace: "nowrap" }}>
                {ogFitLines(f.value, { size: 60, face: "display", width: factW }, 1)[0]}
              </div>
              {f.sub ? <div style={{ fontStyle: "italic", fontSize: 36, color: C.muted, marginTop: 2, whiteSpace: "nowrap" }}>{ogFitLines(f.sub, { size: 36, face: "italic", width: factW }, 1)[0]}</div> : null}
            </div>
          </div>
        ))}
      </div>

      <StoryFooter width={w} />
    </div>
  );
}

function StoryFooter({ width }: { width: number }) {
  const sandal = 88; // twice the capitals' height, toe just under the baseline
  const word = 16 + 178;
  const site = 124;
  const gap = 32;
  return (
    <div style={{ position: "absolute", left: S.pad, bottom: 88, width, height: 60, display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", width: sandal, marginBottom: 16 }}>{ogMarkSvg(sandal, C.ink, C.warm)}</div>
      <div style={{ width: 178, marginLeft: 16, fontFamily: OG_DISPLAY, fontSize: 44, letterSpacing: 9, color: C.ink }}>PYLOS</div>
      <div style={{ display: "flex", marginLeft: gap, marginRight: gap }}>{ogWave(width - sandal - word - site - gap * 2, 3)}</div>
      <div style={{ width: site, display: "flex", justifyContent: "flex-end", fontStyle: "italic", fontSize: 40, color: C.muted }}>pylos.ai</div>
    </div>
  );
}
