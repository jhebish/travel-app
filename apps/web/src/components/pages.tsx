"use client";
/**
 * Trip pages, recap and privacy: who sees each past trip, sharing a past trip's page, "Share while
 * I'm away" for planned trips, memories ("A year ago you were in Kyoto") and the year in travel.
 */
import {
  VISIBILITIES,
  VISIBILITY_LABELS,
  dayAfterTrip,
  memoriesFor,
  memoryLine,
  pastTripShownFrom,
  tripIsOver,
  type PastTrip,
  type PastTripInput,
  type Trip,
  type Visibility,
} from "@travel/core";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { IconShare } from "./icons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "May 2024", "2024", or "". */
export const whenLabel = (t: { year: number | null; month: number | null }) => (t.year ? (t.month ? `${MONTHS[t.month - 1]} ${t.year}` : String(t.year)) : "");

/** "Tue, Dec 1" for a YYYY-MM-DD day. */
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const PAST_HINTS: Record<Visibility, string> = {
  private: "Just you. It still teaches Pylos your taste.",
  followers: "People who follow you see it and the places you loved there.",
  public: "Anyone can see it and the places you loved there, on your profile and its own page.",
};

/** Bring the quick "log a trip" box on the You page into view. */
export function focusQuickLog() {
  const el = document.getElementById("ql-city");
  if (!el) {
    window.location.href = "/profile";
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (el as HTMLInputElement).focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Past trips: who sees them
// ---------------------------------------------------------------------------
/** In the place form: who sees this trip, and whether its dates show. */
export function PlacePrivacyFields({
  value,
  onChange,
}: {
  value: Pick<PastTripInput, "visibility" | "hideDates" | "year" | "month">;
  onChange: (patch: Pick<PastTripInput, "visibility" | "hideDates">) => void;
}) {
  const id = useId();
  const vis = value.visibility ?? "followers";
  const from = pastTripShownFrom(value);
  return (
    <>
      <div className="field">
        <span className="label">Who sees this trip</span>
        <div className="seg" role="group" aria-label="Who sees this trip">
          {VISIBILITIES.map((v) => (
            <button key={v} type="button" aria-pressed={vis === v} onClick={() => onChange({ visibility: v })}>
              {VISIBILITY_LABELS[v]}
            </button>
          ))}
        </div>
        <span className="hint">
          {PAST_HINTS[vis]}
          {from && vis !== "private" ? ` Others see it from ${dayLabel(from)}, once it's over.` : ""}
        </span>
      </div>
      <label className="switch" htmlFor={`${id}-hide`}>
        <div>
          <b>Hide dates</b>
          <span>Others see the city and what you loved, not the year or month.</span>
        </div>
        <input id={`${id}-hide`} type="checkbox" checked={!!value.hideDates} onChange={(e) => onChange({ hideDates: e.target.checked })} />
      </label>
    </>
  );
}

async function savePrivacy(id: string, patch: { visibility?: Visibility; hideDates?: boolean }): Promise<PastTrip> {
  const { place } = await api<{ place: PastTrip }>(`/api/community/past/${id}`, { method: "PATCH", json: patch });
  return place;
}

/** In the list of your places: who sees each one, hide its dates, and share its page. */
export function PastTripControls({ place, member, onChange }: { place: PastTrip; member: boolean; onChange: (p: PastTrip) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const vis = place.visibility ?? "followers";
  const from = pastTripShownFrom(place);

  async function save(patch: { visibility?: Visibility; hideDates?: boolean }) {
    setBusy(true);
    setErr(null);
    try {
      onChange(await savePrivacy(place.id, patch));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ptc">
      <select className="ptc-vis" aria-label={`Who sees ${place.city}`} value={vis} disabled={busy} onChange={(e) => save({ visibility: e.target.value as Visibility })}>
        {VISIBILITIES.map((v) => (
          <option key={v} value={v}>
            {VISIBILITY_LABELS[v]}
          </option>
        ))}
      </select>
      <label className="ptc-dates" htmlFor={`${id}-dates`}>
        <input id={`${id}-dates`} type="checkbox" checked={!!place.hideDates} disabled={busy} onChange={(e) => save({ hideDates: e.target.checked })} />
        Hide dates
      </label>
      <PastTripShare place={place} member={member} onChange={onChange} />
      {from && vis !== "private" && <span className="hint">Shown to others from {dayLabel(from)}</span>}
      {err && (
        <span className="status err" role="status">
          {err}
        </span>
      )}
    </div>
  );
}

/**
 * "Share" on one of your own past trips: the Web Share sheet, or the link copied. A trip that's
 * Only me first asks whether to show it to followers or everyone (the link wouldn't open otherwise).
 */
export function PastTripShare({ place, member, onChange }: { place: PastTrip; member: boolean; onChange: (p: PastTrip) => void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null);
  const vis = place.visibility ?? "followers";

  async function share() {
    const url = `${window.location.origin}/p/${place.id}`;
    const caveat = !member
      ? " Others can open it once you've joined the community (on the You page)."
      : !!pastTripShownFrom(place)
        ? " Others can open it once the trip is over."
        : vis === "followers"
          ? " Only your followers can open it."
          : "";
    setNote(null);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `${place.city} on Pylos`, url });
        if (caveat) setNote({ text: caveat.trim() });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote({ text: `Link copied.${caveat}` });
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // they closed the share sheet
      setNote({ text: `Copy this link: ${url}` });
    }
  }

  async function open(to: Visibility) {
    setBusy(true);
    setNote(null);
    try {
      onChange(await savePrivacy(place.id, { visibility: to }));
      setAsk(false);
      setNote({ text: to === "public" ? "Now anyone can open it. Tap Share to send it." : "Now your followers can open it. Tap Share to send it." });
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : "That didn't save. Try again.", err: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ptc-share">
      <button type="button" className="linkbtn" onClick={() => (vis === "private" ? setAsk(true) : share())} aria-expanded={vis === "private" ? ask : undefined}>
        Share
      </button>
      {ask && (
        <span className="ptc-ask" role="group" aria-label="Who can open the link">
          <span className="hint">Only you can see this trip. Show it to</span>
          <button type="button" className="btn ghost small" disabled={busy} onClick={() => open("followers")}>
            Followers
          </button>
          <button type="button" className="btn ghost small" disabled={busy} onClick={() => open("public")}>
            Everyone
          </button>
          <button type="button" className="linkbtn" onClick={() => setAsk(false)}>
            Cancel
          </button>
        </span>
      )}
      {note && (
        <span className={`status${note.err ? " err" : ""}`} role="status">
          {note.text}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Planned trips: share while away
// ---------------------------------------------------------------------------
/**
 * In a trip's Share sheet: a dated trip is shown to others from the day after it ends. This lets
 * the owner show it sooner. Only for trips that are shared and not over yet.
 */
export function ShareWhileAway({ trip, onChange }: { trip: Trip; onChange: (on: boolean) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const after = dayAfterTrip(trip.request?.startDate, trip.request?.days);
  if (!after || tripIsOver(trip.request) || (trip.visibility ?? "private") === "private" || trip.role === "member") return null;
  const on = !!trip.shareWhileAway;

  async function toggle(next: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/trips/${trip.id}/visibility`, { method: "PUT", json: { shareWhileAway: next } });
      onChange(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="switch" htmlFor={`${id}-away`}>
        <div>
          <b>Share while I&apos;m away</b>
          <span>{on ? "On: people can see it now, while you're there." : `Off: others see it from ${dayLabel(after)}, once you're home, so nobody knows you're away.`}</span>
        </div>
        <input id={`${id}-away`} type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
      </label>
      {err && (
        <p className="status err" role="status">
          {err}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------
const DISMISSED = "pylos.memories.dismissed";
const readDismissed = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-200) : [];
  } catch {
    return [];
  }
};

/**
 * "A year ago you were in Kyoto": a past trip from this month in an earlier year. Dismissed ones
 * stay dismissed this month (in this browser). `onAdd` opens the editor for it; without it, links to it.
 */
export function MemoryCard({ places, onAdd }: { places: PastTrip[]; onAdd?: (id: string) => void }) {
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [today, setToday] = useState<{ year: number; month: number } | null>(null);
  useEffect(() => {
    const d = new Date();
    setToday({ year: d.getFullYear(), month: d.getMonth() + 1 });
    setDismissed(readDismissed());
  }, []);
  if (!today || !dismissed) return null;
  const key = (p: PastTrip) => `${p.id}:${today.year}-${today.month}`;
  const m = memoriesFor(places, today).find((p) => !dismissed.includes(key(p)));
  if (!m || m.year == null) return null;

  function dismiss() {
    const next = [...readDismissed(), key(m!)];
    try {
      localStorage.setItem(DISMISSED, JSON.stringify(next.slice(-200)));
    } catch {
      // private browsing: dismissed until the page reloads
    }
    setDismissed(next);
  }

  return (
    <section className="card memory" aria-label="A trip from this month">
      <div className="memory-head">
        <span className="eyebrow">This month, {whenLabel(m)}</span>
        <button type="button" className="iconbtn" aria-label="Dismiss" onClick={dismiss}>
          ×
        </button>
      </div>
      <h2>{memoryLine({ city: m.city, year: m.year }, today)}</h2>
      {m.highlights ? <p className="lede">{m.highlights}</p> : <p className="hint">Add the places you loved there while you still remember them.</p>}
      <div className="row">
        {onAdd ? (
          <button type="button" className="btn sm" onClick={() => onAdd(m.id)}>
            Add what you loved
          </button>
        ) : (
          <Link className="btn sm" href={`/profile?edit=${m.id}`}>
            Add what you loved
          </Link>
        )}
        <Link className="btn ghost sm" href={`/p/${m.id}`}>
          <IconShare />
          Share it
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Your year in travel
// ---------------------------------------------------------------------------
/** The way in to /recap: "Your 2026 in travel", with the year's counts. */
export function RecapLink({ places, year = new Date().getFullYear() }: { places: Pick<PastTrip, "year" | "countryCode">[]; year?: number }) {
  const mine = places.filter((p) => p.year === year);
  const countries = new Set(mine.map((p) => p.countryCode)).size;
  return (
    <div className="callout row between recap-link">
      <span>
        <b>Your {year} in travel</b>{" "}
        <span className="hint">
          {mine.length
            ? `${mine.length} ${mine.length === 1 ? "trip" : "trips"}, ${countries} ${countries === 1 ? "country" : "countries"} so far. See it, and share it.`
            : "Log this year's trips to see your year, then share it."}
        </span>
      </span>
      <Link className="btn sm" href={`/recap?year=${year}`}>
        See your year
      </Link>
    </div>
  );
}

/**
 * On the home page for people with an account: a memory from this month, and from December, their
 * year in travel. Loads their own places; shows nothing until it has them.
 */
export function HomeLoop({ signedIn }: { signedIn: boolean }) {
  const [places, setPlaces] = useState<PastTrip[] | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    api<{ places: PastTrip[] }>("/api/community/places")
      .then((r) => setPlaces(r.places))
      .catch(() => {});
  }, [signedIn]);
  if (!signedIn || !places?.length) return null;
  const now = new Date();
  const year = now.getFullYear();
  const december = now.getMonth() === 11 && places.some((p) => p.year === year);
  return (
    <>
      <MemoryCard places={places} />
      {december && (
        <section className="card recap-card">
          <div className="head">
            <span className="eyebrow">Your year in travel</span>
            <h2>Your {year} in travel is ready</h2>
            <p className="hint">Your trips, cities and countries, the place you loved most, and a picture to share.</p>
          </div>
          <div className="row">
            <Link className="btn sm" href={`/recap?year=${year}`}>
              See your year
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
