"use client";
import { useEffect, useRef, useState } from "react";

export interface BuildState {
  pct: number; // last progress reported by the server (0–100)
  label: string;
  title: string | null;
  days: { label: string; theme: string; done: boolean }[];
  hotels: null | { done: boolean };
  outlineDone: boolean;
  startedAt: number;
}

export const initialBuild = (): BuildState => ({
  pct: 2,
  label: "Starting",
  title: null,
  days: [],
  hotels: null,
  outlineDone: false,
  startedAt: Date.now(),
});

const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type Status = "done" | "active" | "waiting";
function Step({ status, children }: { status: Status; children: React.ReactNode }) {
  return (
    <li className={`bstep ${status}`}>
      <span className="bstep-icon">{status === "done" ? <Check /> : status === "active" ? <span className="spin" /> : <span className="ring" />}</span>
      <span className="bstep-text">{children}</span>
    </li>
  );
}

/**
 * Live progress while a trip is built. The bar follows the server's real milestones and eases
 * forward between them, so it never stalls or jumps backwards.
 */
export function BuildProgress({ state, destination, daysRequested }: { state: BuildState; destination: string; daysRequested: number }) {
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
  const allDaysDone = planning && state.days.every((d) => d.done) && (!state.hotels || state.hotels.done);
  const daysToShow = state.days.length
    ? state.days
    : Array.from({ length: daysRequested }, (_, i) => ({ label: `Day ${i + 1}`, theme: "", done: false }));

  return (
    <section className="card build" aria-live="polite" aria-busy="true">
      <div className="build-top">
        <div className="build-head">
          <span className="eyebrow">Building your trip to {destination}</span>
          <h2 className={state.title ? "" : "shimmer"}>{state.title ?? "Finding the good stuff"}</h2>
        </div>
        <div className="build-pct" aria-hidden="true">
          {pct}
          <small>%</small>
        </div>
      </div>

      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Trip progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="build-meta">
        <span>{state.label}</span>
        <span className="tabnum">{elapsed}</span>
      </div>

      <ol className="bsteps">
        <Step status={state.pct >= 15 ? "done" : "active"}>Gathering local picks</Step>
        <Step status={planning ? "done" : state.pct >= 15 ? "active" : "waiting"}>Sketching the outline</Step>
        {daysToShow.map((d, i) => (
          <Step key={i} status={d.done ? "done" : planning ? "active" : "waiting"}>
            <b>{d.label}</b>
            {d.theme ? <span className="bstep-sub">{d.theme}</span> : null}
          </Step>
        ))}
        {state.hotels && <Step status={state.hotels.done ? "done" : planning ? "active" : "waiting"}>Places to stay</Step>}
        <Step status={state.pct >= 96 ? "done" : allDaysDone ? "active" : "waiting"}>Checking every place</Step>
      </ol>
    </section>
  );
}
