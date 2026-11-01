"use client";
import { SOURCE_BY_ID, STAY_PRICES, STAY_STYLES, isSourceId, type Hotel, type StayPrefs, type Stop } from "@travel/core";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Trip } from "@/lib/trips";
import { Chips, SingleChips } from "./Chips";

const THUMB = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M2 10h4v11H2zM8 21h9.3a2 2 0 0 0 2-1.6l1.6-7A2 2 0 0 0 19 10h-5.2l.8-4a2 2 0 0 0-2-2.4L8 10z" />
  </svg>
);
const MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M6 2h12a1 1 0 0 1 1 1v19l-7-4.5L5 22V3a1 1 0 0 1 1-1z" />
  </svg>
);

const srcColor = (s: string) => `var(--s-${isSourceId(s) ? s : "reviews"})`;
const srcName = (s: string) => (isSourceId(s) ? SOURCE_BY_ID[s].name : s);

function Source({ p }: { p: Stop | Hotel }) {
  return (
    <span className="src">
      <i style={{ background: srcColor(p.source) }} />
      {srcName(p.source)}
      {p.origin === "ai" && <span className="ai" title="Suggested by the AI from its own knowledge and verified on Google Maps">AI pick</span>}
    </span>
  );
}

function Thumbs({ k, votes, onVote, name }: { k: string; votes: Trip["votes"]; onVote: (k: string, v: 1 | -1) => void; name: string }) {
  const v = votes[k] ?? 0;
  return (
    <div className="thumbs" role="group" aria-label={`Rate ${name}`}>
      <button type="button" className="up" aria-pressed={v === 1} aria-label="Good pick" onClick={() => onVote(k, 1)}>
        {THUMB}
      </button>
      <button type="button" className="down" aria-pressed={v === -1} aria-label="Not for me" onClick={() => onVote(k, -1)}>
        {THUMB}
      </button>
    </div>
  );
}

function PlaceLinks({ p }: { p: Stop | Hotel }) {
  if (!p.place?.mapsUrl && !p.place?.hours?.length) return null;
  return (
    <span className="meta-links">
      {p.place?.mapsUrl && (
        <a href={p.place.mapsUrl} target="_blank" rel="noopener noreferrer">
          Map ↗
        </a>
      )}
      {!!p.place?.hours?.length && (
        <details>
          <summary className="hint" style={{ cursor: "pointer" }}>
            Hours
          </summary>
          <ul className="notes">
            {p.place.hours.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>
      )}
    </span>
  );
}

const ratesUrl = (h: Hotel, city: string) =>
  "https://www.google.com/travel/search?q=" + encodeURIComponent(`${h.name} ${h.neighborhood} ${city}`.trim());

export function TripView({ trip: initial, onChange }: { trip: Trip; onChange?: (t: Trip) => void }) {
  const [trip, setTrip] = useState(initial);
  const [day, setDay] = useState(0);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [stay, setStay] = useState<StayPrefs>(
    initial.request.stay?.styles?.length ? { ...initial.request.stay, on: true } : { on: true, styles: ["Boutique"], price: "$150–300" },
  );
  const [hotelBusy, setHotelBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTrip(initial);
    setDay(0);
  }, [initial.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const it = trip.itinerary;
  const d = it.days[Math.min(day, it.days.length - 1)]!;

  function update(patch: Partial<Pick<Trip, "saved" | "rating" | "votes">>) {
    const next = { ...trip, ...patch };
    setTrip(next);
    onChange?.(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await api(`/api/trips/${trip.id}`, { method: "PATCH", json: { saved: next.saved, rating: next.rating, votes: next.votes } });
        setStatus(null);
      } catch (e) {
        setStatus({ text: (e as Error).message || "Couldn't save your rating. Try again.", err: true });
      }
    }, 500);
  }
  const vote = (k: string, v: 1 | -1) => {
    const votes = { ...trip.votes };
    if (votes[k] === v) delete votes[k];
    else votes[k] = v;
    update({ votes });
  };

  async function findHotels() {
    setHotelBusy(true);
    setStatus(null);
    try {
      const { trip: t } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/hotels`, { method: "POST", json: { stay } });
      setTrip(t);
      onChange?.(t);
    } catch (e) {
      setStatus({ text: (e as Error).message, err: true });
    } finally {
      setHotelBusy(false);
    }
  }

  const counts: Record<string, number> = {};
  let total = 0;
  [...it.days.flatMap((x) => x.stops), ...(it.hotels ?? [])].forEach((p) => {
    counts[p.source] = (counts[p.source] ?? 0) + 1;
    total++;
  });
  const mix = Object.keys(counts).sort((a, b) => counts[b]! - counts[a]!);
  const r = trip.request;
  const profileLine = [r.party, r.age, r.interests.join(" and ").toLowerCase(), r.budget.toLowerCase(), r.pace.toLowerCase()]
    .filter(Boolean)
    .join(" · ");

  const stayControls = (
    <div className="stack" style={{ gap: 12 }}>
      <Chips label="Hotel style" options={STAY_STYLES} value={stay.styles} onChange={(styles) => setStay({ ...stay, styles })} />
      <SingleChips label="Price per night" options={STAY_PRICES} value={stay.price} onChange={(price) => setStay({ ...stay, price })} />
      {hotelBusy ? (
        <span className="thinking">
          <span className="dot" />
          Finding places to stay near where your days happen…
        </span>
      ) : (
        <button type="button" className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={findHotels}>
          {it.hotels?.length ? "Find new hotels" : "Find hotels"}
        </button>
      )}
    </div>
  );

  return (
    <article className="card" aria-live="polite">
      <div className="head">
        <h2>{it.title}</h2>
        <div className="profile-line">
          {profileLine} · {trip.customMix ? "your source mix" : "app default sources"}
        </div>
        <p className="lede">{it.summary}</p>
      </div>

      <div className="feedback">
        <div className="stars" role="group" aria-label="Rate this trip">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={n <= trip.rating ? "on" : ""}
              aria-label={`Rate ${n} of 5`}
              aria-pressed={n === trip.rating}
              onClick={() => update({ rating: trip.rating === n ? 0 : n })}
            >
              ★
            </button>
          ))}
        </div>
        <button type="button" className="savebtn" aria-pressed={trip.saved} onClick={() => update({ saved: !trip.saved })}>
          {MARK}
          {trip.saved ? "Saved" : "Save trip"}
        </button>
      </div>

      <div className="field" aria-label="Where these recommendations came from">
        <span className="label">Source mix</span>
        <div className="mixbar">
          {mix.map((id) => (
            <span key={id} style={{ width: `${((counts[id]! / total) * 100).toFixed(1)}%`, background: srcColor(id) }} title={srcName(id)} />
          ))}
        </div>
        <div className="legend">
          {mix.map((id) => (
            <span key={id}>
              <i style={{ background: srcColor(id) }} />
              {srcName(id)} · {counts[id]}
            </span>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">Where to stay{it.stayLabel ? ` · ${it.stayLabel}` : ""}</span>
        {it.hotels?.length ? (
          <>
            <div className="hotels">
              {it.hotels.map((h, i) => (
                <div className="hotel" key={h.name + i}>
                  <div className="hotel-top">
                    <div className="stop-name">
                      {h.name} <span className="hood">· {h.neighborhood}</span>
                    </div>
                    <span className="price">
                      {h.liveRate ? `$${h.liveRate.nightlyUsd}/night` : h.nightly}
                      {h.liveRate ? <small>Live rate · your dates</small> : null}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {h.style && <span className="style-tag">{h.style}</span>}
                    <Source p={h} />
                  </div>
                  <p className="why">{h.why}</p>
                  {h.localTip && (
                    <p className="tip">
                      <b>Local tip</b> {h.localTip}
                    </p>
                  )}
                  <div className="foot">
                    <span className="meta-links">
                      <a href={ratesUrl(h, trip.destination)} target="_blank" rel="noopener noreferrer">
                        Check rates ↗
                      </a>
                      {h.place?.mapsUrl && (
                        <a href={h.place.mapsUrl} target="_blank" rel="noopener noreferrer">
                          Map ↗
                        </a>
                      )}
                    </span>
                    <Thumbs k={`h-${i}`} votes={trip.votes} onVote={vote} name={h.name} />
                  </div>
                </div>
              ))}
            </div>
            <p className="hint">
              {it.hotels.some((h) => h.liveRate)
                ? "Live rates are for your dates and may change. Other prices are typical nightly estimates."
                : "Prices are typical nightly estimates. Add travel dates for live rates where available."}
            </p>
            <details className="more">
              <summary>Change hotel style or price</summary>
              {stayControls}
            </details>
          </>
        ) : (
          stayControls
        )}
      </div>

      <div className="daytabs" role="tablist">
        {it.days.map((x, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === day} onClick={() => setDay(i)}>
            {x.label}
          </button>
        ))}
      </div>
      <p className="daytheme">{d.theme}</p>
      <ol className="stops">
        {d.stops.map((s, si) => (
          <li className="stop" key={s.name + si}>
            <div className="time">{s.time}</div>
            <div className="stop-body">
              <div className="stop-name">
                {s.name} <span className="hood">· {s.neighborhood}</span>
              </div>
              <p className="why">{s.why}</p>
              {s.localTip && (
                <p className="tip">
                  <b>Local tip</b> {s.localTip}
                </p>
              )}
              <div className="foot">
                <span className="row" style={{ gap: 12 }}>
                  <Source p={s} />
                  <PlaceLinks p={s} />
                </span>
                <Thumbs k={`${day}-${si}`} votes={trip.votes} onVote={vote} name={s.name} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      {!!it.notes?.length && (
        <div className="field">
          <span className="label">Good to know</span>
          <ul className="notes">
            {it.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <p className={`status${status?.err ? " err" : ""}`} role="status">
        {status?.text ?? "Check opening hours before you go."}
      </p>
    </article>
  );
}
