"use client";
import {
  ABOUT_OPTIONS,
  AGE_BANDS,
  BUDGETS,
  INTERESTS,
  PACES,
  PARTIES,
  STAY_PRICES,
  STAY_STYLES,
  type TripRequest,
} from "@travel/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Chips, SingleChips } from "@/components/Chips";
import { TripView } from "@/components/TripView";
import { useMe } from "@/components/useMe";
import { api } from "@/lib/api";
import type { Trip } from "@/lib/trips";

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
  const params = useSearchParams();
  const [req, setReq] = useState<TripRequest>(blank);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [customMix, setCustomMix] = useState<boolean | null>(null);
  const tripRef = useRef<HTMLDivElement>(null);
  const set = <K extends keyof TripRequest>(k: K, v: TripRequest[K]) => setReq((r) => ({ ...r, [k]: v }));

  useEffect(() => {
    if (!me?.user) return;
    api<{ prefs: { useCustom: boolean } | null }>("/api/prefs")
      .then((p) => setCustomMix(!!p.prefs?.useCustom))
      .catch(() => setCustomMix(false));
    const from = params.get("from");
    if (from)
      api<{ trip: Trip }>(`/api/trips/${from}`)
        .then(({ trip }) => {
          setReq({ ...blank, ...trip.request, startDate: null });
          setStatus({ text: "Loaded your earlier request. Adjust anything, then build." });
        })
        .catch(() => {});
  }, [me?.user, params]);

  async function build(e: React.FormEvent) {
    e.preventDefault();
    if (!req.destination.trim()) {
      setStatus({ text: "Add a destination first.", err: true });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const { trip } = await api<{ trip: Trip }>("/api/trips", { method: "POST", json: req });
      setTrip(trip);
      setTimeout(() => tripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (err) {
      setStatus({ text: (err as Error).message, err: true });
    } finally {
      setBusy(false);
    }
  }

  const signedOut = me && !me.user;

  return (
    <>
      <form className="stack" style={{ gap: 28 }} onSubmit={build} autoComplete="off">
        <div className="where">
          <label htmlFor="dest">
            <h1>Where to?</h1>
          </label>
          <input id="dest" type="text" placeholder="Lisbon, Oaxaca, Kyoto…" value={req.destination} onChange={(e) => set("destination", e.target.value)} />
          <p className="lede">Tell us who&apos;s coming and what you&apos;re into. Your plan is built from the places locals actually go.</p>
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
              <button type="button" aria-label="More days" onClick={() => set("days", Math.min(7, req.days + 1))}>
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
              <span>Three hotel options that fit the trip.</span>
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
          <Link className="btn" href="/login?next=/">
            Sign in to build your trip
          </Link>
        ) : (
          <button className="btn" type="submit" disabled={busy || !me}>
            {busy ? "Building your trip" : "Build my trip"}
          </button>
        )}
        <p className={`status${status?.err ? " err" : ""}`} role="status" aria-live="polite">
          {busy ? (
            <span className="thinking">
              <span className="dot" />
              Finding local picks, planning {req.days} {req.days === 1 ? "day" : "days"} and checking every place. This takes about a minute.
            </span>
          ) : (
            status?.text
          )}
        </p>
        </div>
      </form>

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
