"use client";
import {
  SOURCE_BY_ID,
  STAY_PRICES,
  STAY_STYLES,
  buildIcs,
  googleMapsDayUrl,
  isSourceId,
  legBetween,
  legLabel,
  type Hotel,
  type StayPrefs,
  type Stop,
  type Trip,
} from "@travel/core";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Chips, SingleChips } from "./Chips";
import { DayMap } from "./DayMap";
import {
  IconBookmark,
  IconCalendar,
  IconCar,
  IconDown,
  IconLock,
  IconMap,
  IconRefresh,
  IconShare,
  IconSwap,
  IconUnlock,
  IconUp,
  IconWalk,
} from "./icons";

const srcColor = (s: string) => `var(--s-${isSourceId(s) ? s : "reviews"})`;
const srcName = (s: string) => (isSourceId(s) ? SOURCE_BY_ID[s].name : s);
const ratesUrl = (h: Hotel, city: string) =>
  "https://www.google.com/travel/search?q=" + encodeURIComponent(`${h.name} ${h.neighborhood} ${city}`.trim());

function Source({ p }: { p: Stop | Hotel }) {
  return (
    <span className="src">
      <i style={{ background: srcColor(p.source) }} />
      {srcName(p.source)}
      {p.origin === "ai" && (
        <span className="ai" title={p.place ? "Suggested by the AI and confirmed on Google Maps" : "Suggested by the AI from its own knowledge"}>
          AI pick
        </span>
      )}
    </span>
  );
}

function PlaceLinks({ p }: { p: Stop | Hotel }) {
  if (!p.place?.mapsUrl && !p.place?.hours?.length) return null;
  return (
    <span className="links">
      {p.place?.mapsUrl && (
        <a href={p.place.mapsUrl} target="_blank" rel="noopener noreferrer">
          Map
        </a>
      )}
      {!!p.place?.hours?.length && (
        <details>
          <summary>Hours</summary>
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

type Busy = null | { kind: "swap"; key: string } | { kind: "day"; day: number } | { kind: "hotels" } | { kind: "share" } | { kind: "visibility" };
type Vis = NonNullable<Trip["visibility"]>;
const VIS: { value: Vis; label: string; hint: string }[] = [
  { value: "private", label: "Only me", hint: "Hidden from the community." },
  { value: "followers", label: "Followers", hint: "People who follow you see it in their feed and on your profile." },
  { value: "public", label: "Everyone", hint: "Shown on your profile and can rank in the top trips for this city." },
];

/**
 * The full trip. `readOnly` is the public share view: no ratings, editing, or sharing controls.
 */
export function TripView({ trip: initial, readOnly = false, onChange }: { trip: Trip; readOnly?: boolean; onChange?: (t: Trip) => void }) {
  const [trip, setTrip] = useState(initial);
  const [day, setDay] = useState(0);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [swapOpen, setSwapOpen] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [dayHintOpen, setDayHintOpen] = useState(false);
  const [dayHint, setDayHint] = useState("");
  const [stay, setStay] = useState<StayPrefs>(
    initial.request.stay?.styles?.length ? { ...initial.request.stay, on: true } : { on: true, styles: ["Boutique"], price: "$150–300" },
  );
  const [calDate, setCalDate] = useState(initial.request.startDate ?? "");
  const shareDlg = useRef<HTMLDialogElement>(null);
  const calDlg = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTrip(initial);
    setDay(0);
  }, [initial.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const it = trip.itinerary;
  const dIdx = Math.min(day, it.days.length - 1);
  const d = it.days[dIdx]!;
  const city = trip.destination;

  const apply = (t: Trip) => {
    setTrip(t);
    onChange?.(t);
  };
  const fail = (e: unknown) => setStatus({ text: (e as Error).message || "Something went wrong. Try again.", err: true });

  // ----- feedback (debounced) -----
  function update(patch: Partial<Pick<Trip, "saved" | "rating" | "votes">>) {
    const next = { ...trip, ...patch };
    apply(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api(`/api/trips/${trip.id}`, { method: "PATCH", json: { saved: next.saved, rating: next.rating, votes: next.votes } })
        .then(() => setStatus(null))
        .catch(fail);
    }, 500);
  }
  const vote = (k: string, v: 1 | -1) => {
    const votes = { ...trip.votes };
    const turningDown = v === -1 && votes[k] !== -1;
    if (votes[k] === v) delete votes[k];
    else votes[k] = v;
    update({ votes });
    if (turningDown && !k.startsWith("h-")) {
      setSwapOpen(k);
      setHint("");
    } else if (swapOpen === k) setSwapOpen(null);
  };

  // ----- edits -----
  async function edit(body: Record<string, unknown>, b: Busy) {
    setBusy(b);
    setStatus(null);
    try {
      const { trip: t } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/edit`, { method: "POST", json: body });
      apply(t);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  }
  const swap = async (si: number) => {
    const ok = await edit({ action: "swap", day: dIdx, index: si, hint }, { kind: "swap", key: `${dIdx}-${si}` });
    if (ok) {
      setSwapOpen(null);
      setHint("");
    }
  };
  const lock = (si: number, locked: boolean) => {
    // Optimistic: flip locally, then save.
    const next = structuredClone(trip);
    next.itinerary.days[dIdx]!.stops[si]!.locked = locked;
    apply(next);
    api<{ trip: Trip }>(`/api/trips/${trip.id}/edit`, { method: "POST", json: { action: "lock", day: dIdx, index: si, locked } })
      .then((r) => apply(r.trip))
      .catch(fail);
  };
  const regenerate = async () => {
    const ok = await edit({ action: "regenerate_day", day: dIdx, hint: dayHint }, { kind: "day", day: dIdx });
    if (ok) {
      setDayHintOpen(false);
      setDayHint("");
    }
  };
  async function findHotels() {
    setBusy({ kind: "hotels" });
    setStatus(null);
    try {
      const { trip: t } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/hotels`, { method: "POST", json: { stay } });
      apply(t);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  // ----- sharing -----
  const shareUrl = trip.shareToken && typeof window !== "undefined" ? `${window.location.origin}/t/${trip.shareToken}` : null;
  async function setShared(enabled: boolean) {
    setBusy({ kind: "share" });
    try {
      const { trip: t } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/share`, { method: "POST", json: { enabled } });
      apply(t);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  const [visNote, setVisNote] = useState<{ text: string; code?: string } | null>(null);
  async function setVisibility(visibility: Vis) {
    setBusy({ kind: "visibility" });
    setVisNote(null);
    try {
      await api(`/api/trips/${trip.id}/visibility`, { method: "PUT", json: { visibility } });
      apply({ ...trip, visibility });
    } catch (e) {
      setVisNote({ text: (e as Error).message, code: e instanceof ApiError ? e.code : undefined });
    } finally {
      setBusy(null);
    }
  }
  const [copied, setCopied] = useState(false);
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the field is selectable as a fallback */
    }
  }

  // ----- calendar -----
  function downloadIcs(date: string) {
    const ics = buildIcs(it, city, date, readOnly ? window.location.href : shareUrl ?? undefined);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pylos-${city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    calDlg.current?.close();
  }

  // ----- source mix -----
  const counts: Record<string, number> = {};
  let total = 0;
  [...it.days.flatMap((x) => x.stops), ...(it.hotels ?? [])].forEach((p) => {
    counts[p.source] = (counts[p.source] ?? 0) + 1;
    total++;
  });
  const mix = Object.keys(counts).sort((a, b) => counts[b]! - counts[a]!);
  const approxPins = d.stops.some((s) => s.lat != null && !s.place?.lat);

  const stayControls = (
    <div className="stack" style={{ gap: 14 }}>
      <Chips label="Hotel style" options={STAY_STYLES} value={stay.styles} onChange={(styles) => setStay({ ...stay, styles })} />
      <SingleChips label="Price per night" options={STAY_PRICES} value={stay.price} onChange={(price) => setStay({ ...stay, price })} />
      {busy?.kind === "hotels" ? (
        <span className="thinking">
          <span className="dot" />
          Finding places to stay near where your days happen
        </span>
      ) : (
        <button type="button" className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={findHotels}>
          {it.hotels?.length ? "Find new hotels" : "Find hotels"}
        </button>
      )}
    </div>
  );

  return (
    <article className="trip" aria-live="polite">
      {/* ---------- hero ---------- */}
      <header className="hero">
        <span className="where-line">
          {city}, {it.days.length} {it.days.length === 1 ? "day" : "days"}
        </span>
        <h1>{it.title}</h1>
        <p>{it.summary}</p>
        <div className="actions">
          {!readOnly && (
            <button type="button" className="hbtn" aria-pressed={trip.saved} onClick={() => update({ saved: !trip.saved })}>
              <IconBookmark />
              {trip.saved ? "Saved" : "Save"}
            </button>
          )}
          {!readOnly && (
            <button type="button" className="hbtn" onClick={() => shareDlg.current?.showModal()}>
              <IconShare />
              Share
            </button>
          )}
          <button type="button" className="hbtn" onClick={() => calDlg.current?.showModal()}>
            <IconCalendar />
            Add to calendar
          </button>
          {!readOnly && (
            <Link className="hbtn" href={`/profile?log=${trip.id}&city=${encodeURIComponent(city.split(",")[0]!.trim())}`} title="Add it to the places you've been">
              I went
            </Link>
          )}
        </div>
      </header>

      {!readOnly && (
        <div className="ratebar">
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
          <span className="hint">Rate the trip, and give thumbs to stops, so your next trips get better.</span>
        </div>
      )}

      {/* ---------- day ---------- */}
      <div className="daytabs" role="tablist" aria-label="Days">
        {it.days.map((x, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === dIdx} onClick={() => { setDay(i); setSwapOpen(null); setDayHintOpen(false); }}>
            {x.label}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="dayhead">
          <h2>{d.theme}</h2>
          <div className="daytools">
            <a className="btn ghost small" href={googleMapsDayUrl(d.stops, city)} target="_blank" rel="noopener noreferrer">
              <IconMap />
              Open in Google Maps
            </a>
            {!readOnly && (
              <button type="button" className="btn ghost small" onClick={() => setDayHintOpen((o) => !o)} disabled={!!busy}>
                <IconRefresh />
                Rebuild day
              </button>
            )}
          </div>
        </div>

        {!readOnly && dayHintOpen && (
          <div className="swapbox">
            <span className="hint">
              {d.stops.some((s) => s.locked)
                ? "Locked stops stay put. Everything else gets replaced."
                : "Tip: lock the stops you love first. They'll stay put."}
            </span>
            {busy?.kind === "day" ? (
              <span className="thinking">
                <span className="dot" />
                Rebuilding {d.label.toLowerCase()}
              </span>
            ) : (
              <div className="row">
                <input type="text" aria-label="What should change" placeholder="Optional: slower morning, more food, rainy day" value={dayHint} onChange={(e) => setDayHint(e.target.value)} maxLength={200} />
                <button type="button" className="btn ghost" onClick={regenerate}>
                  Rebuild
                </button>
              </div>
            )}
          </div>
        )}

        <DayMap stops={d.stops} />
        {approxPins && <p className="map-note">Pin positions and travel times are approximate until each place is verified.</p>}

        <ol className="timeline">
          {d.stops.map((s, si) => {
            const k = `${dIdx}-${si}`;
            const v = trip.votes[k] ?? 0;
            const leg = d.stops[si + 1] ? legBetween(s, d.stops[si + 1]!) : null;
            const swapping = busy?.kind === "swap" && busy.key === k;
            return (
              <li key={`${s.name}-${si}`} className={`tl-item${s.locked ? " locked" : ""}`}>
                <div className="tl-rail">
                  <span className="tl-node" aria-label={`Stop ${si + 1}${s.locked ? ", locked" : ""}`}>
                    {si + 1}
                  </span>
                  <span className="tl-line" />
                </div>
                <div>
                  <div className="tl-body">
                    <span className="tl-time">{s.time}</span>
                    <div className="tl-name">
                      {s.name} {s.neighborhood && <span className="hood">in {s.neighborhood}</span>}
                    </div>
                    <p className="tl-why">{s.why}</p>
                    {s.localTip && (
                      <p className="tip">
                        <b>Local tip</b> {s.localTip}
                      </p>
                    )}
                    <div className="tl-foot">
                      <span className="row" style={{ gap: 14 }}>
                        <Source p={s} />
                        <PlaceLinks p={s} />
                      </span>
                      {!readOnly && (
                        <div className="tl-tools">
                          <button
                            type="button"
                            className="iconbtn lock"
                            aria-pressed={!!s.locked}
                            aria-label={s.locked ? `Unlock ${s.name}` : `Lock ${s.name} so it stays when you rebuild the day`}
                            title={s.locked ? "Locked: stays when you rebuild the day" : "Lock this stop"}
                            onClick={() => lock(si, !s.locked)}
                          >
                            {s.locked ? <IconLock /> : <IconUnlock />}
                          </button>
                          <button
                            type="button"
                            className="iconbtn"
                            aria-label={`Swap ${s.name} for another option`}
                            title="Swap for another option"
                            disabled={!!busy}
                            onClick={() => {
                              setSwapOpen(swapOpen === k ? null : k);
                              setHint("");
                            }}
                          >
                            <IconSwap />
                          </button>
                          <button type="button" className="iconbtn up" aria-pressed={v === 1} aria-label={`Good pick: ${s.name}`} onClick={() => vote(k, 1)}>
                            <IconUp />
                          </button>
                          <button type="button" className="iconbtn down" aria-pressed={v === -1} aria-label={`Not for me: ${s.name}`} onClick={() => vote(k, -1)}>
                            <IconDown />
                          </button>
                        </div>
                      )}
                    </div>
                    {!readOnly && swapOpen === k && (
                      <div className="swapbox">
                        {swapping ? (
                          <span className="thinking">
                            <span className="dot" />
                            Finding another option for this slot
                          </span>
                        ) : (
                          <>
                            <b>{v === -1 ? "Not quite right? Swap it." : "Swap this stop"}</b>
                            <div className="row">
                              <input type="text" aria-label="What would you prefer" placeholder="Optional: cheaper, no seafood, more lively" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={200} onKeyDown={(e) => e.key === "Enter" && swap(si)} />
                              <button type="button" className="btn ghost" onClick={() => swap(si)}>
                                Swap
                              </button>
                              <button type="button" className="linkbtn" onClick={() => setSwapOpen(null)}>
                                Keep it
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {leg && (
                    <div className="leg">
                      {leg.mode === "walk" ? <IconWalk /> : <IconCar />}
                      {legLabel(leg)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ---------- stays ---------- */}
      {(it.hotels?.length || !readOnly) && (
        <section className="card">
          <div className="head">
            <h2>Where to stay</h2>
            {it.stayLabel && <span className="hint">Matching {it.stayLabel.replace(" · ", ", ")}</span>}
          </div>
          {it.hotels?.length ? (
            <>
              <div className="hotels">
                {it.hotels.map((h, i) => (
                  <div className="hotel" key={h.name + i}>
                    <div className="hotel-top">
                      <h3>
                        {h.name} <span className="hood" style={{ fontWeight: 450, color: "var(--muted)", fontSize: 15 }}>in {h.neighborhood}</span>
                      </h3>
                      <span className="price">
                        {h.liveRate ? `$${h.liveRate.nightlyUsd} a night` : h.nightly}
                        {h.liveRate ? <small>Live rate for your dates</small> : null}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      {h.style && <span className="style-tag">{h.style}</span>}
                      <Source p={h} />
                    </div>
                    <p className="tl-why">{h.why}</p>
                    {h.localTip && (
                      <p className="tip">
                        <b>Local tip</b> {h.localTip}
                      </p>
                    )}
                    <div className="tl-foot">
                      <span className="links">
                        <a href={ratesUrl(h, city)} target="_blank" rel="noopener noreferrer">
                          Check rates
                        </a>
                        {h.place?.mapsUrl && (
                          <a href={h.place.mapsUrl} target="_blank" rel="noopener noreferrer">
                            Map
                          </a>
                        )}
                      </span>
                      {!readOnly && (
                        <div className="tl-tools">
                          <button type="button" className="iconbtn up" aria-pressed={trip.votes[`h-${i}`] === 1} aria-label={`Good pick: ${h.name}`} onClick={() => vote(`h-${i}`, 1)}>
                            <IconUp />
                          </button>
                          <button type="button" className="iconbtn down" aria-pressed={trip.votes[`h-${i}`] === -1} aria-label={`Not for me: ${h.name}`} onClick={() => vote(`h-${i}`, -1)}>
                            <IconDown />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="hint">
                {it.hotels.some((h) => h.liveRate)
                  ? "Live rates are for your dates and can change. Other prices are typical nightly estimates."
                  : "Prices are typical nightly estimates. Add travel dates for live rates where available."}
              </p>
              {!readOnly && (
                <details className="more">
                  <summary>Change hotel style or price</summary>
                  {stayControls}
                </details>
              )}
            </>
          ) : (
            stayControls
          )}
        </section>
      )}

      {/* ---------- notes + sources ---------- */}
      <section className="card">
        {!!it.notes?.length && (
          <div className="field">
            <h3>Good to know</h3>
            <ul className="notes">
              {it.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="field" aria-label="Where these recommendations came from">
          <h3>Where these picks come from</h3>
          <div className="mixbar">
            {mix.map((id) => (
              <span key={id} style={{ width: `${((counts[id]! / total) * 100).toFixed(1)}%`, background: srcColor(id) }} title={srcName(id)} />
            ))}
          </div>
          <div className="legend">
            {mix.map((id) => (
              <span key={id}>
                <i style={{ background: srcColor(id) }} />
                {srcName(id)}, {counts[id]}
              </span>
            ))}
          </div>
        </div>
        <p className={`status${status?.err ? " err" : ""}`} role="status">
          {status?.text ?? "Check opening hours before you go."}
        </p>
      </section>

      {/* ---------- dialogs ---------- */}
      {!readOnly && (
        <dialog ref={shareDlg} className="sheet" aria-labelledby="share-title" onClick={(e) => e.target === shareDlg.current && shareDlg.current?.close()}>
          <div className="stack">
            <div className="head">
              <h2 id="share-title">Share this trip</h2>
              <p className="hint">Anyone with the link can see the plan. Your ratings and the personal details you entered stay private.</p>
            </div>
            <label className="switch" htmlFor="share-on">
              <div>
                <b>Public link</b>
                <span>{trip.shareToken ? "On: the link works for anyone" : "Off: only you can see this trip"}</span>
              </div>
              <input id="share-on" type="checkbox" checked={!!trip.shareToken} disabled={busy?.kind === "share"} onChange={(e) => setShared(e.target.checked)} />
            </label>
            {shareUrl && (
              <>
                <div className="copyrow">
                  <input type="text" readOnly value={shareUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="btn ghost" onClick={() => copy(shareUrl)}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => navigator.share({ title: it.title, text: `My ${city} trip on Pylos`, url: shareUrl }).catch(() => {})}
                  >
                    <IconShare />
                    Share
                  </button>
                )}
              </>
            )}
            <div className="field" style={{ marginTop: 6 }}>
              <span className="label">In the community</span>
              <div className="seg" role="group" aria-label="Who can see this trip in the community">
                {VIS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    aria-pressed={(trip.visibility ?? "private") === v.value}
                    disabled={busy?.kind === "visibility"}
                    onClick={() => setVisibility(v.value)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <span className="hint">
                {VIS.find((v) => v.value === (trip.visibility ?? "private"))!.hint} Your personal details stay private, but stop descriptions may reflect what you told us.
              </span>
              {visNote && (
                <p className="status err" role="status">
                  {visNote.text}{" "}
                  {visNote.code === "needs_email" && <Link href={`/login?next=/trips/${trip.id}`}>Sign in</Link>}
                  {visNote.code === "needs_profile" && <Link href="/profile">Create your profile</Link>}
                </p>
              )}
            </div>
            <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => shareDlg.current?.close()}>
              Done
            </button>
          </div>
        </dialog>
      )}

      <dialog ref={calDlg} className="sheet" aria-labelledby="cal-title" onClick={(e) => e.target === calDlg.current && calDlg.current?.close()}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (calDate) downloadIcs(calDate);
          }}
        >
          <div className="head">
            <h2 id="cal-title">Add to calendar</h2>
            <p className="hint">Downloads a calendar file with every stop. Open it to add the trip to Apple, Google or Outlook Calendar.</p>
          </div>
          <div className="field">
            <label className="label" htmlFor="cal-date">
              First day of the trip
            </label>
            <input id="cal-date" type="date" required value={calDate} onChange={(e) => setCalDate(e.target.value)} />
          </div>
          <button className="btn" disabled={!calDate}>
            <IconCalendar />
            Download calendar file
          </button>
          <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => calDlg.current?.close()}>
            Cancel
          </button>
        </form>
      </dialog>
    </article>
  );
}
