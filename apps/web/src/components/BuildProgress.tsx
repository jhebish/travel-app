"use client";
import type { BuildEvent, Hotel, Itinerary } from "@travel/core";
import { useEffect, useRef, useState } from "react";
import { ItineraryPreview } from "./ItineraryPreview";
import { Mark } from "./Mark";

type Day = Itinerary["days"][number];

export interface BuildState {
  pct: number; // last progress reported by the server (0–100)
  label: string;
  title: string | null;
  /** Why it suits them, from their history; null when there's nothing specific. */
  forYou: string | null;
  multi: boolean;
  route: { city: string; days: number }[] | null;
  days: { label: string; theme: string; city?: string; data?: Day }[];
  hotels: null | { done: boolean; list: Hotel[]; doneCount?: number };
  outlineDone: boolean;
  startedAt: number;
}

export const initialBuild = (opts: { multi?: boolean; hotels?: boolean } = {}): BuildState => ({
  pct: 2,
  label: "Starting",
  title: null,
  forYou: null,
  multi: !!opts.multi,
  route: null,
  days: [],
  hotels: opts.hotels ? { done: false, list: [] } : null,
  outlineDone: false,
  startedAt: Date.now(),
});

/** Fold one streamed event into the build state. */
export function reduceBuild(b: BuildState, e: BuildEvent): BuildState {
  switch (e.type) {
    case "progress":
      return { ...b, pct: Math.max(b.pct, e.pct), label: e.label };
    case "request":
      return { ...b, multi: e.request.mode === "multi", hotels: e.request.stay.on ? (b.hotels ?? { done: false, list: [] }) : null };
    case "outline":
      return {
        ...b,
        title: e.title,
        forYou: e.forYou || null,
        outlineDone: true,
        route: e.route ?? null,
        multi: b.multi || !!e.route,
        days: e.days.map((d) => ({ ...d })),
        hotels: e.hotels ? (b.hotels ?? { done: false, list: [] }) : null,
      };
    case "day":
      return { ...b, days: b.days.map((d, i) => (i === e.index ? { ...d, data: e.day ?? d.data, city: e.day?.city ?? d.city } : d)) };
    case "hotels": {
      const list = [...(b.hotels?.list ?? []), ...(e.hotels ?? [])];
      // Single trips get one hotels event; multi-city trips get one per stop.
      const expected = b.route ? b.route.length : 1;
      const doneCount = b.hotels?.doneCount ?? 0;
      const next = { done: doneCount + 1 >= expected, list, doneCount: doneCount + 1 };
      return { ...b, hotels: next };
    }
    default:
      return b;
  }
}

/**
 * Live progress while a trip is built. The bar follows the server's real milestones and eases
 * forward between them; days appear underneath as soon as each one is planned.
 */
export function BuildProgress({ state, destination }: { state: BuildState; destination: string }) {
  const [shown, setShown] = useState(state.pct);
  const [now, setNow] = useState(Date.now());
  const target = useRef(state.pct);
  target.current = state.pct;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(() => {
      setNow(Date.now());
      setShown((s) => {
        const t = target.current;
        if (reduce) return t;
        if (s < t) return Math.min(t, s + Math.max(0.6, (t - s) * 0.18)); // catch up quickly
        const ceiling = Math.min(97, t + 9); // then creep slowly toward the next milestone
        return s < ceiling ? s + 0.06 : s;
      });
    }, 120);
    return () => clearInterval(id);
  }, []);

  const pct = Math.max(0, Math.min(100, Math.round(shown)));
  const secs = Math.max(0, Math.floor((now - state.startedAt) / 1000));
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const planning = state.outlineDone;
  const doneDays = state.days.filter((d) => d.data).length;
  const previewDays = state.days.map((d) => ({ label: d.label, theme: d.theme, city: d.city ?? d.data?.city, stops: d.data?.stops }));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card build" aria-live="polite" aria-busy="true">
        <div className="build-top">
          <div className="build-head">
            <span className="eyebrow">
              {state.multi ? "Planning your route through" : "Building your trip to"} {destination}
            </span>
            <h2 className={state.title ? "" : "shimmer"}>{state.title ?? (state.multi ? "Finding the right stops" : "Finding the good stuff")}</h2>
          </div>
          <div className="build-pct" aria-hidden="true">
            {pct}
            <small>%</small>
          </div>
        </div>

        <div className="bar-walk">
          {/* The winged sandal walks the wave as the trip comes together. */}
          <span className="walker" style={{ left: `${pct}%`, transform: `translateX(-${pct}%)` }} aria-hidden="true">
            <Mark width={36} tight cut="mid" />
          </span>
          <div className="bar wave" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Trip progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="build-meta">
          <span>
            {state.label}
            {planning && state.days.length > 1 ? ` · ${doneDays} of ${state.days.length} days ready` : ""}
          </span>
          <span className="tabnum">{elapsed}</span>
        </div>

      </section>

      {planning && (
        <section className="card draft" aria-label="Your trip so far">
          <div className="head">
            <span className="eyebrow">Your trip so far</span>
            {state.forYou && (
              <p className="foryou-note">
                <b>For you</b> {state.forYou}
              </p>
            )}
          </div>
          <ItineraryPreview days={previewDays} route={state.route ?? undefined} />
        </section>
      )}
    </div>
  );
}
