"use client";
import {
  COUNTRIES,
  DESTINATIONS,
  PICK_GROUPS,
  flag,
  type CityPick,
  type CityPicks,
  type PastTrip,
  type PickKind,
} from "@travel/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { kindFromName } from "./taste";

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 40 }, (_, i) => THIS_YEAR - i);
const CITY_NAMES = [...new Set(DESTINATIONS.filter((d) => d.kind === "city").map((d) => d.name))].sort();
const keyOf = (name: string) => name.trim().toLowerCase();

/** A plan's stops and hotels, offered first when logging a Pylos trip ("I went"). */
export interface PresetTrip {
  tripId: string;
  city: string;
  picks: CityPick[];
}

/**
 * The fast way to log a past trip: type the city, tick what you loved from a ready-made list of
 * its best-known places, hit Next. Repeat for the next city.
 */
export function QuickLog({ onSaved, preset, onPresetDone }: { onSaved: (p: PastTrip) => void; preset?: PresetTrip | null; onPresetDone?: () => void }) {
  const [city, setCity] = useState("");
  const [year, setYear] = useState<number | null>(null);
  const [list, setList] = useState<CityPicks | null>(null);
  const [fromPlan, setFromPlan] = useState<CityPick[]>([]);
  const [extra, setExtra] = useState<CityPick[]>([]);
  const [loved, setLoved] = useState<Set<string>>(new Set());
  const [country, setCountry] = useState("");
  const [other, setOther] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ city: string; loved: number }[]>([]);
  const [tripId, setTripId] = useState<string | null>(null);
  const cityInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const picking = !!list;

  // One request per city; a known city starts loading as soon as it's typed or picked.
  const requests = useRef(new Map<string, Promise<CityPicks>>());
  function fetchPicks(name: string) {
    const k = keyOf(name);
    let p = requests.current.get(k);
    if (!p) {
      p = api<CityPicks>("/api/taste/city-picks", { method: "POST", json: { city: name } });
      p.catch(() => requests.current.delete(k));
      requests.current.set(k, p);
    }
    return p;
  }
  useEffect(() => {
    const known = CITY_NAMES.find((c) => keyOf(c) === keyOf(city));
    if (known && !picking) fetchPicks(known).catch(() => {});
  }, [city, picking]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(name: string) {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchPicks(name);
      if (!r.found) {
        setErr(`We couldn't find “${name}”. Check the spelling, or try the nearest city.`);
        return null;
      }
      setList(r);
      setCountry(r.countryCode ?? "");
      return r;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  // "I went" on a Pylos trip: start on the ticking step with that plan's places.
  useEffect(() => {
    if (!preset) return;
    setTripId(preset.tripId);
    setCity(preset.city);
    setYear(THIS_YEAR);
    setFromPlan(preset.picks);
    setList({ found: true, city: preset.city, countryCode: null, picks: [] });
    void load(preset.city).then((r) => !r && setList({ found: true, city: preset.city, countryCode: null, picks: [] }));
  }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...fromPlan, ...extra, ...(list?.picks ?? [])].filter((p) => {
      const k = keyOf(p.name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [fromPlan, extra, list]);

  const toggle = (name: string) =>
    setLoved((s) => {
      const n = new Set(s);
      if (n.has(keyOf(name))) n.delete(keyOf(name));
      else n.add(keyOf(name));
      return n;
    });

  function addOther(e?: React.FormEvent) {
    e?.preventDefault();
    const name = other.trim().slice(0, 120);
    if (!name) return;
    if (!all.some((p) => keyOf(p.name) === keyOf(name))) {
      const kind = kindFromName(name);
      setExtra((x) => [{ kind: (kind === "city" ? "sight" : kind) as PickKind, name, note: "" }, ...x]);
    }
    setLoved((s) => new Set(s).add(keyOf(name)));
    setOther("");
  }

  function reset() {
    setList(null);
    setFromPlan([]);
    setExtra([]);
    setLoved(new Set());
    setCity("");
    setOther("");
    setCountry("");
    setTripId(null);
    setErr(null);
  }

  async function next() {
    if (!list) return;
    if (!country) return setErr("Pick the country so we can place it on your map.");
    setSaving(true);
    setErr(null);
    try {
      const picks = all.filter((p) => loved.has(keyOf(p.name)));
      const r = await api<{ place: PastTrip; loved: number; lost: number }>("/api/taste/quick-log", {
        method: "POST",
        json: {
          trip: { city: list.city, countryCode: country, year, month: null, days: null, rating: null, highlights: "", tripId },
          loved: picks.map(({ kind, name, note }) => ({ kind, name, note })),
        },
      });
      onSaved(r.place);
      setDone((d) => [...d, { city: r.place.city, loved: r.loved }]);
      if (r.lost) setErr("The trip was saved, but some places weren't. Edit it to add them again.");
      const wasPreset = !!tripId;
      reset();
      if (wasPreset) onPresetDone?.();
      top.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setTimeout(() => cityInput.current?.focus(), 50);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const n = loved.size;
  return (
    <div className="quicklog stack" ref={top}>
      {done.length > 0 && !picking && (
        <p className="ql-done" role="status">
          <span aria-hidden="true">✓</span>{" "}
          {done
            .map((d) => `${d.city}${d.loved ? ` (${d.loved} ${d.loved === 1 ? "favorite" : "favorites"})` : ""}`)
            .join(", ")}{" "}
          saved. Where else have you been?
        </p>
      )}

      {!picking ? (
        <form
          className="ql-city"
          onSubmit={(e) => {
            e.preventDefault();
            if (city.trim().length >= 2) void load(city.trim());
          }}
        >
          <div className="field ql-where">
            <label className="label" htmlFor="ql-city">
              {done.length ? "Another city" : "Where did you go?"}
            </label>
            <input
              id="ql-city"
              ref={cityInput}
              type="text"
              list="ql-cities"
              maxLength={80}
              placeholder="Lisbon, Tokyo, the Amalfi Coast…"
              autoComplete="off"
              enterKeyHint="next"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            <datalist id="ql-cities">
              {CITY_NAMES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="field ql-year">
            <label className="label" htmlFor="ql-year">
              When
            </label>
            <select id="ql-year" value={year ?? ""} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not sure</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit" disabled={loading || city.trim().length < 2}>
            {loading ? "Finding places…" : "Next"}
          </button>
        </form>
      ) : (
        <div className="ql-pick stack">
          <div className="ql-head">
            <div>
              <span className="eyebrow">{year ? `Your trip in ${year}` : "Your trip"}</span>
              <h3>
                {country && <span aria-hidden="true">{flag(country)} </span>}
                {list.city}
              </h3>
            </div>
            <button type="button" className="linkbtn" onClick={reset}>
              Change city
            </button>
          </div>
          <p className="hint">Tap everything you loved. Pylos uses it to predict the hotels and restaurants you&apos;ll like next.</p>

          {!list.countryCode && !loading && (
            <div className="field">
              <label className="label" htmlFor="ql-country">
                Country
              </label>
              <select id="ql-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Choose…</option>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {flag(code)} {name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {fromPlan.length > 0 && <PickGroup label="From your Pylos plan" picks={fromPlan} loved={loved} onToggle={toggle} />}
          {extra.length > 0 && <PickGroup label="You added" picks={extra} loved={loved} onToggle={toggle} />}
          {loading ? (
            <div className="ql-grid" aria-busy="true" aria-label="Loading places">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="ql-item skeleton" />
              ))}
            </div>
          ) : (
            PICK_GROUPS.map((g) => {
              const shown = new Set([...fromPlan, ...extra].map((p) => keyOf(p.name)));
              const picks = (list.picks ?? []).filter((p) => g.kinds.includes(p.kind) && !shown.has(keyOf(p.name)));
              return picks.length ? <PickGroup key={g.label} label={g.label} picks={picks} loved={loved} onToggle={toggle} /> : null;
            })
          )}

          <form className="ql-other" onSubmit={addOther}>
            <label className="label" htmlFor="ql-other">
              Something else you loved?
            </label>
            <div className="row tight">
              <input id="ql-other" type="text" maxLength={120} placeholder="A restaurant, hotel or spot" value={other} onChange={(e) => setOther(e.target.value)} />
              <button type="submit" className="btn ghost" disabled={!other.trim()}>
                Add
              </button>
            </div>
          </form>

          <div className="ql-bar">
            <span className="hint" aria-live="polite">
              {n ? `${n} loved` : "Nothing ticked yet"}
            </span>
            <button type="button" className="btn" onClick={next} disabled={saving || loading}>
              {saving ? "Saving…" : "Next"}
            </button>
          </div>
        </div>
      )}
      {err && (
        <p className="status err" role="status">
          {err}
        </p>
      )}
    </div>
  );
}

function PickGroup({ label, picks, loved, onToggle }: { label: string; picks: CityPick[]; loved: Set<string>; onToggle: (name: string) => void }) {
  return (
    <section className="ql-group" aria-label={label}>
      <span className="label">{label}</span>
      <div className="ql-grid">
        {picks.map((p) => {
          const on = loved.has(keyOf(p.name));
          return (
            <button key={p.name} type="button" className="ql-item" aria-pressed={on} onClick={() => onToggle(p.name)}>
              <span className="ql-heart" aria-hidden="true">
                {on ? "♥" : "♡"}
              </span>
              <span className="ql-text">
                <b>{p.name}</b>
                {p.note && <small>{p.note}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
