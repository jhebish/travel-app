"use client";
import {
  ABOUT_OPTIONS,
  AGE_BANDS,
  BUDGETS,
  INTERESTS,
  MAX_DAYS,
  PACES,
  PARTIES,
  STAY_PRICES,
  STAY_STYLES,
  type BrowseDestination,
  type BuildEvent,
  type TripMode,
  type TripRequest,
} from "@travel/core";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Chips, SingleChips } from "@/components/Chips";
import { TripView } from "@/components/TripView";
import { useMe } from "@/components/useMe";
import { api, streamEvents } from "@/lib/api";
import { BuildProgress, initialBuild, reduceBuild, type BuildState } from "@/components/BuildProgress";
import type { Trip } from "@/lib/trips";

const TypeformIntake = dynamic(() => import("@/components/TypeformIntake"), {
  ssr: false,
  loading: () => <div className="tf-wrap tf-loading" aria-busy="true" />,
});

const ABOUT_LABELS: Record<string, string> = {
  "LGBTQ+ traveler": "LGBTQ+",
  "Eats halal": "Halal",
  Vegetarian: "Vegetarian",
  "Doesn't drink alcohol": "Sober",
  "Needs step-free access": "Step-free",
  "First time visiting": "First visit",
  "Has been before": "Been before",
};
const PARTY_LABELS: Record<string, string> = { Solo: "Solo", Couple: "Couple", "Family with kids": "Family", "Group of friends": "Friends" };
const BUDGET_LABELS: Record<string, string> = { Budget: "$", "Mid-range": "$$", Splurge: "$$$" };

const blank: TripRequest = {
  mode: "single",
  destination: "",
  days: 3,
  startDate: null,
  party: "Couple",
  age: "25–34",
  about: [],
  budget: "Mid-range",
  interests: ["Food"],
  pace: "Balanced",
  extra: "",
  stay: { on: true, styles: ["Boutique"], price: "$150–300" },
};

function Planner() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const [trending, setTrending] = useState<BrowseDestination[]>([]);
  const [req, setReq] = useState<TripRequest>(blank);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [customMix, setCustomMix] = useState<boolean | null>(null);
  const tripRef = useRef<HTMLDivElement>(null);
  // Typeform intake: undefined while checking, null when it isn't set up.
  const [tfForm, setTfForm] = useState<string | null | undefined>(undefined);
  const [mode, setMode] = useState<"typeform" | "quick">("typeform");
  const [tfKey, setTfKey] = useState(0);
  const [building, setBuilding] = useState<{ destination: string; days: number }>({ destination: "", days: 3 });
  const set = <K extends keyof TripRequest>(k: K, v: TripRequest[K]) => setReq((r) => ({ ...r, [k]: v }));

  useEffect(() => {
    api<{ formId: string | null }>("/api/typeform")
      .then((r) => setTfForm(r.formId))
      .catch(() => setTfForm(null));
    api<{ destinations: BrowseDestination[] }>("/api/browse")
      .then((r) => setTrending(r.destinations.slice(0, 6)))
      .catch(() => {});
  }, []);

  // Links from Browse and Friends: /plan?dest=Egypt&mode=multi&days=7
  useEffect(() => {
    const dest = params.get("dest");
    if (!dest) return;
    const m: TripMode = params.get("mode") === "multi" ? "multi" : "single";
    const days = Number(params.get("days"));
    setMode("quick");
    setReq((r) => ({
      ...r,
      mode: m,
      destination: dest.slice(0, 120),
      days: days >= 1 ? Math.min(MAX_DAYS[m], Math.round(days)) : m === "multi" ? Math.max(r.days, 5) : Math.min(r.days, MAX_DAYS.single),
    }));
  }, [params]);

  function setTripMode(m: TripMode) {
    setReq((r) => ({ ...r, mode: m, days: m === "multi" ? Math.max(r.days, 5) : Math.min(r.days, MAX_DAYS.single) }));
  }

  function pickTrending(d: BrowseDestination) {
    const m: TripMode = d.kind === "region" ? "multi" : "single";
    setReq((r) => ({ ...r, mode: m, destination: d.kind === "region" ? d.name : `${d.name}, ${d.country}`, days: m === "multi" ? Math.max(r.days, d.sampleDays) : Math.min(r.days, MAX_DAYS.single) }));
  }

  useEffect(() => {
    if (!me?.user) return;
    api<{ prefs: { useCustom: boolean } | null }>("/api/prefs")
      .then((p) => setCustomMix(!!p.prefs?.useCustom))
      .catch(() => setCustomMix(false));
    const from = params.get("from");
    if (from)
      api<{ trip: Trip }>(`/api/trips/${from}`)
        .then(({ trip }) => {
          setMode("quick");
          setReq({ ...blank, ...trip.request, startDate: null });
          setStatus({ text: "Loaded your earlier request. Adjust anything, then build." });
        })
        .catch(() => {});
  }, [me?.user, params]);

  function onEvent(e: BuildEvent) {
    setBuild((b) => (b ? reduceBuild(b, e) : b));
  }

  /** Stream a build from `path` and show live progress, then the finished trip. */
  async function runBuild(path: string, body: unknown, info: { destination: string; days: number; hotels: boolean; multi?: boolean }) {
    setBusy(true);
    setStatus(null);
    setTrip(null);
    setBuilding({ destination: info.destination, days: info.days });
    setBuild(initialBuild({ multi: info.multi, hotels: info.hotels }));
    setTimeout(() => progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    let finished: Trip | null = null;
    let failure: string | null = null;
    let redirect: string | null = null;
    try {
      await streamEvents<BuildEvent>(path, body, (ev) => {
        if (ev.type === "done") finished = ev.trip;
        else if (ev.type === "error") failure = ev.message;
        else if (ev.type === "redirect") redirect = ev.to;
        else {
          if (ev.type === "request") setBuilding({ destination: ev.request.destination, days: ev.request.days });
          onEvent(ev);
        }
      });
      if (redirect) {
        router.push(redirect);
        return;
      }
      if (finished) {
        setBuild((b) => (b ? { ...b, pct: 100, label: "Done" } : b));
        await new Promise((r) => setTimeout(r, 450)); // let the bar land at 100%
        setTrip(finished);
        setTimeout(() => tripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      } else {
        setStatus({ text: failure ?? "The connection dropped before your trip finished. Try again.", err: true });
      }
    } catch (err) {
      setStatus({ text: (err as Error).message, err: true });
    } finally {
      setBusy(false);
      setBuild(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!req.destination.trim()) {
      setStatus({ text: "Add a destination first.", err: true });
      return;
    }
    await runBuild("/api/trips", req, { destination: req.destination.trim(), days: req.days, hotels: req.stay.on, multi: req.mode === "multi" });
  }

  function onTypeformSubmit(responseId: string) {
    void runBuild("/api/typeform/build", { responseId }, { destination: "", days: 3, hotels: false });
  }

  const signedOut = me && !me.user;

  const useTypeform = !!tfForm && mode === "typeform";
  const modeSwitch = tfForm ? (
    <p className="hint" style={{ textAlign: "center" }}>
      {useTypeform ? (
        <button type="button" className="linkbtn" onClick={() => setMode("quick")}>
          Prefer a quick one-page form?
        </button>
      ) : (
        <button type="button" className="linkbtn" onClick={() => setMode("typeform")}>
          Answer one question at a time instead
        </button>
      )}
    </p>
  ) : null;

  return (
    <>
      {useTypeform && (
        <section className="stack" style={{ gap: 14 }}>
          <div className="where">
            <h1>Where to?</h1>
            <p className="lede">A minute of questions about who&apos;s coming and what you&apos;re into. Your plan is built from the places locals actually go.</p>
          </div>
          {me?.user ? (
            busy || trip ? (
              !busy && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setTrip(null);
                    setStatus(null);
                    setTfKey((k) => k + 1);
                  }}
                >
                  Plan another trip
                </button>
              )
            ) : (
              <TypeformIntake key={tfKey} formId={tfForm!} uid={me.user.id} onSubmit={onTypeformSubmit} />
            )
          ) : (
            <div className="tf-wrap tf-loading" aria-busy="true" />
          )}
          {status?.err && !busy && (
            <>
              <p className="status err" role="status">
                {status.text}
              </p>
              <button type="button" className="btn ghost" onClick={() => { setStatus(null); setTfKey((k) => k + 1); }}>
                Start the form again
              </button>
            </>
          )}
          {modeSwitch}
        </section>
      )}

      {!useTypeform && tfForm !== undefined && (
      <form className="stack" style={{ gap: 28 }} onSubmit={submit} autoComplete="off">
        <div className="where">
          <div className="seg triptype" role="radiogroup" aria-label="Kind of trip">
            <button type="button" role="radio" aria-checked={req.mode === "single"} onClick={() => setTripMode("single")}>
              One place
            </button>
            <button type="button" role="radio" aria-checked={req.mode === "multi"} onClick={() => setTripMode("multi")}>
              Several stops
            </button>
            <button type="button" role="radio" aria-checked={false} onClick={() => router.push("/")}>
              Not sure yet
            </button>
          </div>
          <label htmlFor="dest">
            <h1>{req.mode === "multi" ? "Which country or region?" : "Where to?"}</h1>
          </label>
          <input
            id="dest"
            type="text"
            placeholder={req.mode === "multi" ? "Egypt, Japan, the Amalfi Coast…" : "Lisbon, Oaxaca, Kyoto…"}
            value={req.destination}
            onChange={(e) => set("destination", e.target.value)}
          />
          <p className="lede">
            {req.mode === "multi"
              ? "We'll choose the stops, the order and how long to spend in each, then plan every day the way locals would."
              : "Tell us who's coming and what you're into. Your plan is built from the places locals actually go."}
          </p>
          {trending.length > 0 && (
            <div className="trending" aria-label="Trending destinations">
              <span className="label">Trending now</span>
              <div className="chips">
                {trending.map((d) => (
                  <button key={d.key} type="button" className="chip" onClick={() => pickTrending(d)}>
                    {d.name}
                    {d.kind === "region" && <small>several stops</small>}
                  </button>
                ))}
                <Link className="chip chip-link" href="/">
                  See the globe →
                </Link>
              </div>
            </div>
          )}
        </div>
        <div className="card">
        <div className="two">
          <div className="field">
            <span className="label">Days</span>
            <div className="stepper">
              <button type="button" aria-label="Fewer days" onClick={() => set("days", Math.max(1, req.days - 1))}>
                −
              </button>
              <output>
                {req.days} {req.days === 1 ? "day" : "days"}
              </output>
              <button type="button" aria-label="More days" onClick={() => set("days", Math.min(MAX_DAYS[req.mode], req.days + 1))}>
                +
              </button>
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="start">
              Start date <small>(optional, for live hotel rates)</small>
            </label>
            <input id="start" type="date" value={req.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
          </div>
        </div>
        <div className="field">
          <span className="label">Who&apos;s going</span>
          <SingleChips label="Who's going" options={PARTIES.map((v) => ({ value: v, label: PARTY_LABELS[v] }))} value={req.party} onChange={(v) => set("party", v)} />
        </div>
        <div className="two">
          <div className="field">
            <span className="label">Age</span>
            <SingleChips label="Age" options={AGE_BANDS} value={req.age} onChange={(v) => set("age", v)} />
          </div>
          <div className="field">
            <span className="label">Budget</span>
            <SingleChips label="Budget" options={BUDGETS.map((v) => ({ value: v, label: BUDGET_LABELS[v] }))} value={req.budget} onChange={(v) => set("budget", v)} />
          </div>
        </div>
        <div className="field">
          <span className="label">
            About you <small>(optional, private to you)</small>
          </span>
          <Chips label="About you" options={ABOUT_OPTIONS.map((v) => ({ value: v, label: ABOUT_LABELS[v] }))} value={req.about} onChange={(v) => set("about", v)} />
        </div>

        <div className="field">
          <label className="switch" htmlFor="stay-on">
            <div>
              <b>Suggest places to stay</b>
              <span>{req.mode === "multi" ? "Two options at each stop." : "Three hotel options that fit the trip."}</span>
            </div>
            <input id="stay-on" type="checkbox" checked={req.stay.on} onChange={(e) => set("stay", { ...req.stay, on: e.target.checked })} />
          </label>
          {req.stay.on && (
            <div className="stack" style={{ gap: 14 }}>
              <div className="field">
                <span className="label">Style</span>
                <Chips label="Hotel style" options={STAY_STYLES} value={req.stay.styles} onChange={(styles) => set("stay", { ...req.stay, styles })} />
              </div>
              <div className="field">
                <span className="label">Per night</span>
                <SingleChips label="Price per night" options={STAY_PRICES} value={req.stay.price} onChange={(price) => set("stay", { ...req.stay, price })} />
              </div>
            </div>
          )}
        </div>

        <details className="more">
          <summary>More preferences</summary>
          <div className="stack">
            <div className="field">
              <span className="label">Into</span>
              <Chips label="Interests" options={INTERESTS} value={req.interests} onChange={(v) => set("interests", v)} />
            </div>
            <div className="field">
              <span className="label">Pace</span>
              <SingleChips label="Pace" options={PACES} value={req.pace} onChange={(v) => set("pace", v)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="extra">
                Anything else
              </label>
              <textarea id="extra" maxLength={500} placeholder="Anniversary trip, hate crowds, staying near the old town…" value={req.extra} onChange={(e) => set("extra", e.target.value)} />
            </div>
          </div>
        </details>

        {me?.user && (
          <p className="hint">
            Using {customMix ? "your own source mix" : "the app's default sources"}. <Link href="/sources">Adjust my mix</Link>
          </p>
        )}
        {signedOut ? (
          <Link className="btn" href="/login?next=/plan">
            Sign in to build your trip
          </Link>
        ) : (
          <button className="btn" type="submit" disabled={busy || !me}>
            {busy ? "Building your trip" : "Build my trip"}
          </button>
        )}
        <p className={`status${status?.err ? " err" : ""}`} role="status" aria-live="polite">
          {busy ? "" : status?.text}
        </p>
        </div>
        {modeSwitch}
      </form>
      )}

      <div ref={progressRef}>{build && <BuildProgress state={build} destination={building.destination || "your destination"} daysRequested={building.days} />}</div>
      <div ref={tripRef}>{trip && <TripView trip={trip} />}</div>
      {trip && (
        <p className="hint" style={{ textAlign: "center" }}>
          Saved to <Link href="/trips">My trips</Link>.
        </p>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Planner />
    </Suspense>
  );
}
