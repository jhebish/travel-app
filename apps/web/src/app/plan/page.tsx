"use client";
import {
  ABOUT_OPTIONS,
  AGE_BANDS,
  BUDGETS,
  INTERESTS,
  MAX_DAYS,
  MONTH_NAMES,
  PACES,
  PARTIES,
  STAY_PRICES,
  STAY_STYLES,
  soonMonth,
  travelMonth,
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
import { FriendsWhoveBeen, InspiredBy, buildPath, useLikeTrip } from "@/components/Friends";
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

/** The next twelve months, starting with this one, for "When are you going?". */
function upcomingMonths() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { value: d.getMonth() + 1, label: `${MONTH_NAMES[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}` };
  });
}

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
  clubs: false,
  pace: "Balanced",
  extra: "",
  stay: { on: true, styles: ["Boutique"], price: "$150–300" },
  with: [],
};

function Planner() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const [trending, setTrending] = useState<BrowseDestination[]>([]);
  const [req, setReq] = useState<TripRequest>(blank);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [customMix, setCustomMix] = useState<boolean | null>(null);
  // Typeform intake: undefined while checking, null when it isn't set up.
  const [tfForm, setTfForm] = useState<string | null | undefined>(undefined);
  const [mode, setMode] = useState<"typeform" | "quick">("typeform");
  const [tfKey, setTfKey] = useState(0);
  const [building, setBuilding] = useState<{ destination: string; days: number }>({ destination: "", days: 3 });
  const set = <K extends keyof TripRequest>(k: K, v: TripRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  // When they travel decides the stops (beach towns only in beach season). Default: the weeks ahead.
  const [months, setMonths] = useState<{ value: number; label: string }[]>([]);
  useEffect(() => {
    setMonths(upcomingMonths());
    setReq((r) => (r.month === undefined && !r.startDate ? { ...r, month: soonMonth() } : r));
  }, []);
  // Friends you can plan with (people you follow who follow you back).
  const [friends, setFriends] = useState<{ handle: string; displayName: string }[]>([]);
  useEffect(() => {
    if (!me?.user || me.user.isGuest) return;
    api<{ friends: { handle: string; displayName: string }[] }>("/api/together/friends")
      .then((r) => setFriends(r.friends))
      .catch(() => {});
  }, [me?.user]);

  useEffect(() => {
    api<{ formId: string | null }>("/api/typeform")
      .then((r) => setTfForm(r.formId))
      .catch(() => setTfForm(null));
    api<{ destinations: BrowseDestination[] }>("/api/browse")
      .then((r) => setTrending(r.destinations.slice(0, 6)))
      .catch(() => {});
  }, []);

  // Nightlife: get the city's bars and clubs of the moment ready while they finish the form (it
  // takes the server about a minute the first time a city is asked for, then it's kept a month).
  const warmed = useRef(new Set<string>());
  const signedIn = !!me?.user;
  useEffect(() => {
    const dest = req.destination.trim();
    if (!signedIn || req.mode !== "single" || dest.length < 3 || !req.interests.includes("Nightlife")) return;
    const key = dest.toLowerCase();
    if (warmed.current.has(key)) return;
    const t = setTimeout(() => {
      warmed.current.add(key);
      api("/api/nightlife", { method: "POST", json: { destination: dest } }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [signedIn, req.mode, req.destination, req.interests]);

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

  // "Plan a trip like this" (/plan?like=<past trip id>): its city now, its loved places in the build.
  const like = useLikeTrip((destination) => {
    setMode("quick");
    setReq((r) => ({ ...r, mode: "single", destination: destination.slice(0, 120), days: Math.min(r.days, MAX_DAYS.single) }));
  });

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
          setReq({ ...blank, ...trip.request, startDate: null, month: travelMonth(trip.request) ?? soonMonth() });
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
        // Our own pages in the app; anything else (a trip we don't plan) is a full page load.
        const to: string = redirect;
        if (to.startsWith("/")) router.push(to);
        else if (to.startsWith("https://")) window.location.assign(to);
        return;
      }
      if (finished) {
        setBuild((b) => (b ? { ...b, pct: 100, label: "Done" } : b));
        await new Promise((r) => setTimeout(r, 450)); // let the bar land at 100%
        // The trip opens on its own page: it survives a reload and can be bookmarked or linked.
        router.push(`/trips/${(finished as Trip).id}`);
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
    await runBuild(buildPath(like, req.destination), req, { destination: req.destination.trim(), days: req.days, hotels: req.stay.on, multi: req.mode === "multi" });
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
            busy ? null : <TypeformIntake key={tfKey} formId={tfForm!} uid={me.user.id} onSubmit={onTypeformSubmit} />
          ) : me ? (
            // No session (a guest account couldn't be started): sign in instead of an endless placeholder.
            <Link className="btn" href="/login?next=/plan">
              Sign in to build your trip
            </Link>
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
        <form className="stack planner" onSubmit={submit} autoComplete="off">
          <div className="where">
            <div className="seg triptype" role="radiogroup" aria-label="Kind of trip">
              <button type="button" role="radio" aria-checked={req.mode === "single"} onClick={() => setTripMode("single")}>
                One place
              </button>
              <button type="button" role="radio" aria-checked={req.mode === "multi"} onClick={() => setTripMode("multi")}>
                Several stops
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
            <InspiredBy like={like} destination={req.destination} />
            {/* Ideas only while the box is empty: picking one fills it. */}
            {trending.length > 0 && !req.destination.trim() && (
              <div className="trending" aria-label="Trending destinations">
                <span className="label">Trending</span>
                {trending.slice(0, 5).map((d) => (
                  <button key={d.key} type="button" className="chip" onClick={() => pickTrending(d)}>
                    {d.name}
                    {d.kind === "region" && <small>several stops</small>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {req.mode === "single" && <FriendsWhoveBeen city={req.destination} month={travelMonth(req)} />}

          <div className="card plan-card">
            <div className="plan-when">
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
                <label className="label" htmlFor="month">
                  When
                </label>
                <select
                  id="month"
                  value={travelMonth(req) ?? ""}
                  disabled={!!req.startDate}
                  onChange={(e) => set("month", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Not sure yet</option>
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="two plan-who">
              <div className="field">
                <span className="label">Who&apos;s going</span>
                <SingleChips label="Who's going" options={PARTIES.map((v) => ({ value: v, label: PARTY_LABELS[v] }))} value={req.party} onChange={(v) => set("party", v)} />
              </div>
              <div className="field">
                <span className="label">Budget</span>
                <SingleChips label="Budget" options={BUDGETS.map((v) => ({ value: v, label: BUDGET_LABELS[v] }))} value={req.budget} onChange={(v) => set("budget", v)} />
              </div>
            </div>

            {/* Everything else has a sensible default, and your past trips already steer the picks. */}
            <details className="more">
              <summary>
                More options <small>interests, pace, hotels, exact dates</small>
              </summary>
              <div className="stack">
                <div className="field">
                  <span className="label">Into</span>
                  <Chips
                    label="Interests"
                    options={INTERESTS}
                    value={req.interests}
                    onChange={(v) => setReq((r) => ({ ...r, interests: v, clubs: v.includes("Nightlife") ? r.clubs : false }))}
                  />
                  {/* A night out is drinks; dancing until late is its own ask. */}
                  {req.interests.includes("Nightlife") && req.party !== "Family with kids" && (
                    <label className="switch" htmlFor="clubs">
                      <div>
                        <b>Clubs and dancing too</b>
                        <span>Out late at the clubs locals go to. Without it, nights are drinks at good bars.</span>
                      </div>
                      <input id="clubs" type="checkbox" checked={req.clubs} onChange={(e) => set("clubs", e.target.checked)} />
                    </label>
                  )}
                </div>
                <div className="two">
                  <div className="field">
                    <span className="label">Pace</span>
                    <SingleChips label="Pace" options={PACES} value={req.pace} onChange={(v) => set("pace", v)} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="start">
                      Start date
                    </label>
                    <input
                      id="start"
                      type="date"
                      value={req.startDate ?? ""}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        setReq((r) => ({ ...r, startDate: v, month: v ? Number(v.slice(5, 7)) : r.month }));
                      }}
                    />
                  </div>
                </div>
                <div className="field">
                  <span className="label">Age</span>
                  <SingleChips label="Age" options={AGE_BANDS} value={req.age} onChange={(v) => set("age", v)} />
                </div>
                <div className="field">
                  <span className="label">
                    About you <small>(private to you)</small>
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
                    <div className="two">
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
                {friends.length > 0 && (
                  <div className="field">
                    <span className="label">
                      Plan with friends <small>(they can edit it with you)</small>
                    </span>
                    <div className="chips">
                      {friends.slice(0, 20).map((f) => {
                        const on = (req.with ?? []).includes(f.handle);
                        return (
                          <button
                            key={f.handle}
                            type="button"
                            className="chip"
                            aria-pressed={on}
                            onClick={() => set("with", on ? (req.with ?? []).filter((h) => h !== f.handle) : [...(req.with ?? []), f.handle].slice(0, 7))}
                          >
                            {f.displayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="field">
                  <label className="label" htmlFor="extra">
                    Anything else
                  </label>
                  <textarea id="extra" maxLength={500} placeholder="Anniversary trip, hate crowds, staying near the old town…" value={req.extra} onChange={(e) => set("extra", e.target.value)} />
                </div>
                {me?.user && (
                  <p className="hint">
                    Using {customMix ? "your own source mix" : "the app's default sources"}. <Link href="/sources">Adjust my mix</Link>
                  </p>
                )}
              </div>
            </details>

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

      <div ref={progressRef}>{build && <BuildProgress state={build} destination={building.destination || "your destination"} />}</div>
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
