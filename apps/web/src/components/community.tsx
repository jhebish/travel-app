"use client";
import {
  COUNTRIES,
  countryName,
  flag,
  type CommunityTrip,
  type PastTrip,
  type PastTripInput,
  type PersonDTO,
  type TravelStats,
} from "@travel/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PlaceItemsEditor, type PlaceItem } from "./taste";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** A colored initials circle; the hue comes from the handle so it's stable per person. */
export function Avatar({ person, size = 40 }: { person: Pick<PersonDTO, "displayName" | "handle">; size?: number }) {
  let h = 0;
  for (const c of person.handle) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 45% 30%)` }}>
      {initials(person.displayName)}
    </span>
  );
}

export function PersonLine({ person, sub }: { person: PersonDTO; sub?: React.ReactNode }) {
  return (
    <Link href={`/u/${person.handle}`} className="person">
      <Avatar person={person} />
      <span className="person-text">
        <b>{person.displayName}</b>
        <span>
          @{person.handle}
          {sub ? <> · {sub}</> : person.homeCity ? <> · {person.homeCity}</> : null}
        </span>
      </span>
    </Link>
  );
}

export function LevelBadge({ stats }: { stats: TravelStats }) {
  return <span className="level">{stats.level.name}</span>;
}

export function StatsRow({ stats, showNext = false }: { stats: TravelStats; showNext?: boolean }) {
  const pct = stats.next ? Math.round(((stats.countries - stats.level.min) / (stats.next.level.min - stats.level.min)) * 100) : 100;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="stats">
        <div>
          <b className="tabnum">{stats.countries}</b>
          <span>{stats.countries === 1 ? "country" : "countries"}</span>
        </div>
        <div>
          <b className="tabnum">{stats.cities}</b>
          <span>{stats.cities === 1 ? "city" : "cities"}</span>
        </div>
        <div>
          <b className="tabnum">{stats.trips}</b>
          <span>{stats.trips === 1 ? "trip logged" : "trips logged"}</span>
        </div>
      </div>
      {showNext && stats.next && (
        <div className="levelbar">
          <div className="levelbar-top">
            <LevelBadge stats={stats} />
            <span className="hint">
              {stats.next.countriesToGo} more {stats.next.countriesToGo === 1 ? "country" : "countries"} to <b>{stats.next.level.name}</b>
            </span>
          </div>
          <div className="bar thin" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progress to next level">
            <span style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function FollowButton({ handle, initial, onChange }: { handle: string; initial: boolean; onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/community/follow", { method: "POST", json: { handle, follow: !on } });
      setOn(!on);
      onChange?.(!on);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="follow">
      <button type="button" className={`btn ${on ? "ghost" : ""} sm`} aria-pressed={on} disabled={busy} onClick={toggle}>
        {on ? "Following" : "Follow"}
      </button>
      {err && (
        <span className="status err" role="status">
          {err}
          {/profile first/i.test(err) && (
            <>
              {" "}
              <Link href="/profile">Create it</Link>
            </>
          )}
          {/sign in/i.test(err) && (
            <>
              {" "}
              <Link href="/login?next=/friends">Sign in</Link>
            </>
          )}
        </span>
      )}
    </span>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function TripCard({ trip, showOwner = true, rank }: { trip: CommunityTrip; showOwner?: boolean; rank?: number }) {
  return (
    <article className="tcard">
      {rank != null && <span className="tcard-rank tabnum">{rank}</span>}
      <Link href={`/c/${trip.id}`} className="tcard-main">
        <span className="tcard-where">
          {trip.destination.split(",")[0]} · {trip.days} {trip.days === 1 ? "day" : "days"}
        </span>
        <b className="tcard-title">{trip.title}</b>
        <span className="tcard-meta">
          {[trip.party, trip.pace, trip.budget].filter(Boolean).join(" · ")}
          {trip.interests.length ? ` · ${trip.interests.slice(0, 3).join(", ")}` : ""}
        </span>
      </Link>
      <div className="tcard-foot">
        {showOwner ? (
          <Link href={`/u/${trip.owner.handle}`} className="tcard-owner">
            <Avatar person={trip.owner} size={22} />
            {trip.owner.displayName}
          </Link>
        ) : (
          <span className="hint">{fmtDate(trip.createdAt)}</span>
        )}
        <span className="tcard-likes" aria-label={`${trip.likes} likes`}>
          <span aria-hidden="true">{trip.iLiked ? "♥" : "♡"}</span> <span className="tabnum">{trip.likes}</span>
          {trip.ownerRating > 0 && (
            <span className="tcard-stars" aria-label={`Owner rated ${trip.ownerRating} of 5`}>
              {" "}
              · {"★".repeat(trip.ownerRating)}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

export function PlaceChip({ place }: { place: PastTrip }) {
  return (
    <span className="place">
      <span aria-hidden="true">{flag(place.countryCode)}</span> {place.city}
      {place.year ? <small> {place.year}</small> : null}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const blankPlace = (city = "", tripId: string | null = null): PastTripInput => ({
  city,
  countryCode: "",
  year: new Date().getFullYear(),
  month: null,
  days: null,
  rating: null,
  highlights: "",
  tripId,
});

/** Add or edit one place someone has been, and what they did there. */
export function PlaceForm({
  initial,
  onSaved,
  onCancel,
  suggestions,
}: {
  initial?: { id?: string; value: PastTripInput };
  onSaved: (p: PastTrip) => void;
  onCancel?: () => void;
  /** Places from a Pylos plan for this trip, offered as "did you go?" chips. */
  suggestions?: PlaceItem[];
}) {
  const [v, setV] = useState<PastTripInput>(initial?.value ?? blankPlace());
  const [items, setItems] = useState<PlaceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editingId = initial?.id;

  // Editing: load what they already said they did there.
  useEffect(() => {
    if (!editingId) return;
    api<{ items: PlaceItem[] }>(`/api/taste/trip/${editingId}`)
      .then((r) => setItems(r.items.map(({ kind, name, liked }) => ({ kind, name, liked }))))
      .catch(() => {});
  }, [editingId]);
  const set = <K extends keyof PastTripInput>(k: K, val: PastTripInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const years = Array.from({ length: 60 }, (_, i) => new Date().getFullYear() + 1 - i);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!v.city.trim()) return setErr("Add the city.");
    if (!v.countryCode) return setErr("Pick the country.");
    setBusy(true);
    setErr(null);
    try {
      const { place } = initial?.id
        ? await api<{ place: PastTrip }>(`/api/community/places/${initial.id}`, { method: "PUT", json: v })
        : await api<{ place: PastTrip }>("/api/community/places", { method: "POST", json: v });
      const filled = items.filter((it) => it.name.trim());
      if (filled.length || initial?.id) {
        await api(`/api/taste/trip/${place.id}`, { method: "PUT", json: { items: filled } }).catch(() =>
          setErr("The trip was saved, but the places you did there weren't. Edit it to try again."),
        );
      }
      onSaved(place);
      if (!initial?.id) {
        setV(blankPlace());
        setItems([]);
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="placeform stack" onSubmit={save}>
      <div className="two">
        <div className="field">
          <label className="label" htmlFor="pf-city">
            City or region
          </label>
          <input id="pf-city" type="text" maxLength={80} placeholder="Lisbon" value={v.city} onChange={(e) => set("city", e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-country">
            Country
          </label>
          <select id="pf-country" value={v.countryCode} onChange={(e) => set("countryCode", e.target.value)}>
            <option value="">Choose…</option>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {flag(code)} {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="three">
        <div className="field">
          <label className="label" htmlFor="pf-year">
            Year
          </label>
          <select id="pf-year" value={v.year ?? ""} onChange={(e) => set("year", e.target.value ? Number(e.target.value) : null)}>
            <option value="">Not sure</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-month">
            Month
          </label>
          <select id="pf-month" value={v.month ?? ""} onChange={(e) => set("month", e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-days">
            Days
          </label>
          <input
            id="pf-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={v.days ?? ""}
            onChange={(e) => set("days", e.target.value ? Math.max(1, Math.min(365, Number(e.target.value))) : null)}
          />
        </div>
      </div>
      <div className="field">
        <span className="label">How was it?</span>
        <div className="stars" role="group" aria-label="Rate the trip">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={v.rating && n <= v.rating ? "on" : ""} aria-label={`${n} of 5`} aria-pressed={n === v.rating} onClick={() => set("rating", v.rating === n ? null : n)}>
              ★
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="pf-hi">
          What did you love? <small>(helps us plan your next trip)</small>
        </label>
        <textarea id="pf-hi" maxLength={500} placeholder="The night markets, a tiny ramen bar near the station, hiking above town…" value={v.highlights} onChange={(e) => set("highlights", e.target.value)} />
      </div>
      <PlaceItemsEditor items={items} onChange={setItems} suggestions={suggestions} />
      {err && (
        <p className="status err" role="status">
          {err}
        </p>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : initial?.id ? "Save changes" : "Add place"}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export { blankPlace, countryName };
