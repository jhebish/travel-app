"use client";
import {
  AIRBNB_ICONS,
  SOURCE_BY_ID,
  STAY_PRICES,
  STAY_STYLES,
  airbnbSearchUrl,
  buildIcs,
  dateSpan,
  fitText,
  googleMapsDayUrl,
  guestsFor,
  guestsText,
  isSourceId,
  legBetween,
  legLabel,
  lengthFit,
  rangeText,
  stayWindows,
  type Hotel,
  type PlaceVerification,
  type StayPrefs,
  type Stop,
  type Together,
  type Trip,
  type TripLength,
} from "@travel/core";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Chips, SingleChips } from "./Chips";
import { DayMap } from "./DayMap";
import {
  IconBookmark,
  IconCalendar,
  IconCar,
  IconDown,
  IconGlobe,
  IconLock,
  IconMap,
  IconPeople,
  IconPhone,
  IconRefresh,
  IconShare,
  IconSun,
  IconSwap,
  IconUnlock,
  IconUp,
  IconWalk,
} from "./icons";
import { PhotoGallery, type GalleryTarget } from "./PhotoGallery";
import { PlacePhoto } from "./PlacePhoto";
import { TogetherSheet, WhoIsIn } from "./Together";

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

const siteLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
};

/** Airbnb's own icon, loaded from Airbnb; tries the next copy if one fails, and hides if none load. */
function AirbnbIcon() {
  const [n, setN] = useState(0);
  if (n >= AIRBNB_ICONS.length) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a remote favicon, not a photo to optimize
    <img src={AIRBNB_ICONS[n]} alt="" width={20} height={20} loading="lazy" referrerPolicy="no-referrer" onError={() => setN((i) => i + 1)} />
  );
}

/** Airbnb's search for each place on the trip, with its dates and guests, in a new tab. */
function Rentals({ trip, startDate, lead = "Rather rent a whole place?" }: { trip: Trip; startDate: string | null; lead?: string }) {
  const windows = stayWindows(trip, { startDate });
  const guests = guestsFor(trip.request);
  const many = windows.length > 1;
  return (
    <div className="rentals">
      <span className="rentals-label">{lead}</span>
      <div className="rentals-row">
        {windows.map((w, i) => {
          const when = w.checkin && w.checkout ? dateSpan(w.checkin, w.checkout) : "Any dates";
          return (
            <a
              key={`${w.place}-${i}`}
              className="airbnb-btn"
              href={airbnbSearchUrl(w, guests)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Search Airbnb in ${w.city}, ${when}, ${guestsText(guests)} (opens in a new tab)`}
            >
              <AirbnbIcon />
              <span className="airbnb-text">
                <span className="airbnb-name">{many ? `Airbnb in ${w.city}` : "Search Airbnb"}</span>
                <small>
                  {when} · {guestsText(guests)}
                </small>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** How long most people stay, against the days planned. */
function IdealDays({ ideal, days, place }: { ideal: TripLength; days: number; place: string }) {
  const fit = lengthFit(days, ideal);
  return (
    <p className={`ideal-days ${fit}`}>
      <span className="ideal-head">
        <b>Recommended</b>
        <span className="ideal-range">{rangeText(ideal)}</span>
        <span className="ideal-fit">{fitText(days, ideal, place)}</span>
      </span>
      {ideal.note && <span className="ideal-note">{ideal.note}</span>}
    </p>
  );
}

/** The place's own website and phone number, when Google Maps lists them. */
function Contact({ place }: { place?: PlaceVerification }) {
  return (
    <>
      {place?.website && (
        <a className="contact" href={place.website} target="_blank" rel="noopener noreferrer" title={place.website}>
          <IconGlobe />
          <span>{siteLabel(place.website)}</span>
        </a>
      )}
      {place?.phone && (
        <a className="contact phone" href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}>
          <IconPhone />
          <span>{place.phone}</span>
        </a>
      )}
    </>
  );
}

function PlaceLinks({ p }: { p: Stop | Hotel }) {
  const pl = p.place;
  if (!pl || (!pl.mapsUrl && !pl.hours?.length && !pl.website && !pl.phone)) return null;
  return (
    <span className="links">
      {pl.mapsUrl && (
        <a href={pl.mapsUrl} target="_blank" rel="noopener noreferrer">
          Map
        </a>
      )}
      {!!pl.hours?.length && (
        <details>
          <summary>Hours</summary>
          <ul className="notes">
            {pl.hours.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>
      )}
      <Contact place={pl} />
    </span>
  );
}

/** What a stop costs, roughly ("EGP 500 a boat for an hour (~$10)", "Free"). */
function Cost({ p }: { p: Stop }) {
  if (!p.cost) return null;
  return (
    <p className="cost">
      <b>Cost</b> {p.cost}
    </p>
  );
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-03" or "2026-03-14" → "Mar 2026". */
const monthYear = (d: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(d);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}` : "";
};

/** A bar or club that recent sources call one of the places to go now, with those sources. */
function HotNow({ hot }: { hot?: Stop["hot"] | null }) {
  const sources = hot?.sources ?? [];
  if (!sources.length) return null;
  return (
    <p className="hot-now">
      <b>Hot right now</b>
      <span>
        {sources.map((s, i) => {
          const when = s.date ? monthYear(s.date) : "";
          return (
            <span className="src" key={`${s.name}-${i}`}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>
              ) : (
                s.name
              )}
              {when && <span className="when"> {when}</span>}
            </span>
          );
        })}
      </span>
    </p>
  );
}

/** A city's night pulse as the API shows it (app/api/nightlife). */
interface PulseView {
  city: string;
  updated: string;
  /** Earlier lists exist, so "new" means new this month (the first list would make everything new). */
  hasHistory: boolean;
  spots: {
    name: string;
    neighborhood: string;
    type: "bar" | "club";
    style: string;
    when: string;
    door: string;
    why: string;
    hot: Stop["hot"] | null;
    mapsUrl?: string;
    since: string;
  }[];
}

/**
 * Going out: the city's bars and clubs of the moment (the night pulse), beyond the one or two in
 * the plan. Only for trips that asked for nightlife, and only once the city's list exists.
 */
function GoingOut({ city, clubsFirst }: { city: string; clubsFirst: boolean }) {
  const [pulse, setPulse] = useState<PulseView | null>(null);
  const [tab, setTab] = useState<"bar" | "club">(clubsFirst ? "club" : "bar");
  useEffect(() => {
    let alive = true;
    api<{ pulse: PulseView | null }>(`/api/nightlife?city=${encodeURIComponent(city)}`)
      .then((r) => alive && setPulse(r.pulse))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [city]);
  if (!pulse?.spots.length) return null;
  const bars = pulse.spots.filter((s) => s.type === "bar");
  const clubs = pulse.spots.filter((s) => s.type === "club");
  const list = (tab === "club" && clubs.length) || !bars.length ? clubs : bars;
  const recent = (since: string) => pulse.hasHistory && Date.now() - Date.parse(since) <= 40 * 864e5;
  return (
    <section className="card going-out">
      <div className="head">
        <h2>Going out in {pulse.city}</h2>
        <span className="hint">Where people go now, from recent coverage. Updated {monthYear(pulse.updated) || "this month"}.</span>
      </div>
      {bars.length > 0 && clubs.length > 0 && (
        <div className="seg" role="tablist" aria-label="Kind of night out">
          <button type="button" role="tab" aria-selected={list === bars} onClick={() => setTab("bar")}>
            Drinks
          </button>
          <button type="button" role="tab" aria-selected={list === clubs} onClick={() => setTab("club")}>
            Dancing
          </button>
        </div>
      )}
      <ul className="spots">
        {list.slice(0, 8).map((s) => (
          <li key={s.name}>
            <div className="spot-name">
              {s.name} {s.neighborhood && <span className="hood">in {s.neighborhood}</span>}
              {recent(s.since) && <span className="pill new">New</span>}
            </div>
            <HotNow hot={s.hot} />
            {s.why && <p className="tl-why">{s.why}</p>}
            {(s.style || s.when || s.door) && <p className="meta">{[s.style, s.when, s.door].filter(Boolean).join(" · ")}</p>}
            {s.mapsUrl && (
              <a className="map-link" href={s.mapsUrl} target="_blank" rel="noopener noreferrer">
                Map
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Shown when a pick matches what you've loved before (from your taste profile). */
function ForYou({ p }: { p: Stop | Hotel }) {
  if (!p.forYou) return null;
  return (
    <p className="foryou-note">
      <b>For you</b> {p.forYou}
    </p>
  );
}

type Busy =
  | null
  | { kind: "swap"; key: string }
  | { kind: "day"; day: number }
  | { kind: "city"; leg: number; city: string }
  | { kind: "hotels" }
  | { kind: "share" }
  | { kind: "visibility" };
type Vis = NonNullable<Trip["visibility"]>;
const VIS: { value: Vis; label: string; hint: string }[] = [
  { value: "private", label: "Only me", hint: "Hidden from the community." },
  { value: "followers", label: "Followers", hint: "People who follow you see it in their feed and on your profile." },
  { value: "public", label: "Everyone", hint: "Shown on your profile and can rank in the top trips for this city." },
];

/**
 * The full trip. `readOnly` is the public share view: no ratings, editing, or sharing controls.
 */
export function TripView({
  trip: initial,
  readOnly = false,
  onChange,
  together: initialTogether = null,
  toolbar,
}: {
  trip: Trip;
  readOnly?: boolean;
  onChange?: (t: Trip) => void;
  /** Present when friends are planning this trip together. */
  together?: Together | null;
  /** Shown under the title, e.g. the days slider on shared and destination pages. */
  toolbar?: React.ReactNode;
}) {
  const [tripState, setTrip] = useState(initial);
  // Read-only views just follow their props (the days slider changes the itinerary they get).
  const trip = readOnly ? initial : tripState;
  const [tog, setTog] = useState<Together | null>(initialTogether);
  const isMember = trip.role === "member";
  const isOwner = !readOnly && !isMember;
  const togetherOn = !readOnly && !!tog && tog.people.length > 1;
  const me = tog?.people.find((p) => p.me);
  const togDlg = useRef<HTMLDialogElement>(null);
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
  const [gallery, setGallery] = useState<GalleryTarget | null>(null);
  const openGallery = (title: string, place: PlaceVerification | undefined, start = 0) => {
    if (place?.photos?.length) setGallery({ title, placeId: place.placeId, photos: place.photos, start });
  };
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
  /** On a multi-city trip, a day's places belong to that day's city. */
  const dayCity = d.city ? `${d.city}, ${city}` : city;
  // The dates for booking a stay: the trip's start date, or the one picked for the calendar.
  const stayStart = trip.request.startDate ?? (/^\d{4}-\d{2}-\d{2}$/.test(calDate) ? calDate : null);

  // How long most people stay. New trips carry it; others (older trips, shared links, destination
  // pages) ask once: cached per destination, and only a signed-in visit asks the model.
  const [ideal, setIdeal] = useState<TripLength | null>(it.idealDays ?? null);
  const tripMode = it.mode ?? trip.request.mode ?? "single";
  useEffect(() => {
    if (it.idealDays) {
      setIdeal(it.idealDays);
      return;
    }
    setIdeal(null);
    let gone = false;
    api<{ idealDays: TripLength | null }>(`/api/trip-length?${new URLSearchParams({ destination: trip.destination, mode: tripMode })}`)
      .then((r) => {
        if (!gone) setIdeal(r.idealDays);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [trip.id, trip.destination, it.idealDays, tripMode]);

  const pickDay = (i: number) => {
    setDay(i);
    setSwapOpen(null);
    setDayHintOpen(false);
  };
  const apply = (t: Trip) => {
    setTrip(t);
    onChange?.(t);
  };
  const fail = (e: unknown) => setStatus({ text: (e as Error).message || "Something went wrong. Try again.", err: true });
  // Messages pop up at the bottom of the screen (visible wherever you are on the page) and clear themselves.
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), status.err ? 9000 : 5000);
    return () => clearTimeout(id);
  }, [status]);

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

  /** Send a vote save that's still waiting, so an edit can't overwrite it. */
  async function flushVotes() {
    if (!timer.current || !isOwner) return;
    clearTimeout(timer.current);
    timer.current = null;
    await api(`/api/trips/${trip.id}`, { method: "PATCH", json: { saved: trip.saved, rating: trip.rating, votes: trip.votes } }).catch(() => {});
  }

  // ----- planning together: "I'm in" / "pass" per stop -----
  const myReaction = (k: string): 1 | -1 | 0 => (me ? (tog?.reactions[k]?.[me.userId] ?? 0) : 0);
  async function react(k: string, v: 1 | -1) {
    if (!tog || !me) return;
    const value = myReaction(k) === v ? 0 : v;
    const next = structuredClone(tog);
    const row = (next.reactions[k] ??= {});
    if (value) row[me.userId] = value;
    else delete row[me.userId];
    setTog(next);
    if (value === -1 && !k.startsWith("h-")) {
      setSwapOpen(k);
      setHint("");
    }
    try {
      const r = await api<{ together: Together }>(`/api/trips/${trip.id}/together/react`, { method: "POST", json: { item: k, value } });
      setTog(r.together);
    } catch (e) {
      fail(e);
    }
  }
  /** Thumbs: your own feedback, and on a shared trip also what you tell your friends. */
  const thumb = (k: string, v: 1 | -1) => {
    if (togetherOn) void react(k, v);
    if (isOwner) vote(k, v);
  };
  const pressed = (k: string, v: 1 | -1) => (togetherOn && isMember ? myReaction(k) === v : trip.votes[k] === v);

  // ----- edits -----
  async function edit(body: Record<string, unknown>, b: Busy) {
    if (busy) return;
    setBusy(b);
    setStatus(null);
    await flushVotes();
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
    if (busy) return;
    // Optimistic: flip locally, then save (after any vote still waiting to save). Undone if it fails,
    // so a stop never looks locked when it isn't.
    const before = trip;
    const next = structuredClone(trip);
    next.itinerary.days[dIdx]!.stops[si]!.locked = locked;
    apply(next);
    void flushVotes()
      .then(() => api<{ trip: Trip }>(`/api/trips/${trip.id}/edit`, { method: "POST", json: { action: "lock", day: dIdx, index: si, locked } }))
      .then((r) => apply(r.trip))
      .catch((e) => {
        apply(before);
        fail(e);
      });
  };
  // ----- multi-city: swap a stop on the route for another town -----
  const [cityPick, setCityPick] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherCity, setOtherCity] = useState("");
  const swapCity = async (leg: number, to: string) => {
    const ok = await edit({ action: "swap_city", leg, city: to }, { kind: "city", leg, city: to });
    if (ok) {
      setCityPick(null);
      setOtherOpen(false);
      setOtherCity("");
    }
  };
  const regenerate = async () => {
    const ok = await edit({ action: "regenerate_day", day: dIdx, hint: dayHint }, { kind: "day", day: dIdx });
    if (ok) {
      setDayHintOpen(false);
      setDayHint("");
    }
  };
  async function findHotels() {
    if (busy) return;
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
  const [shareNote, setShareNote] = useState<string | null>(null);
  async function setShared(enabled: boolean) {
    if (busy) return;
    setBusy({ kind: "share" });
    setShareNote(null);
    try {
      const { trip: t } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/share`, { method: "POST", json: { enabled } });
      apply(t);
    } catch (e) {
      setShareNote((e as Error).message || "Couldn't change the link. Try again.");
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

  // The stop the current day is in (multi-city): its season, why it's here, and towns to swap in.
  const route = it.mode === "multi" || (it.route?.length ?? 0) > 1 ? (it.route ?? []) : [];
  const legIdx = route.findIndex((l) => l.city === d.city);
  const leg = legIdx >= 0 ? route[legIdx]! : null;
  const onRoute = new Set(route.map((l) => l.city.trim().toLowerCase()));
  const swaps = (leg?.alternatives ?? []).filter((a) => !onRoute.has(a.city.trim().toLowerCase())).slice(0, 3);
  const lockedHere = leg ? it.days.filter((x) => x.city === leg.city).reduce((n, x) => n + x.stops.filter((s) => s.locked).length, 0) : 0;
  useEffect(() => {
    // Moving to another stop clears a half-made swap.
    setCityPick(null);
    setOtherOpen(false);
  }, [legIdx]);
  const legCard =
    route.length > 1 && leg && (leg.season || leg.why || !readOnly) ? (
      <section className="legcard" aria-label={`About ${leg.city}`}>
        {(leg.season || leg.why) && (
          <div className="legcard-text">
            {leg.season && (
              <p className="leg-season">
                <IconSun />
                <span>{leg.season}</span>
              </p>
            )}
            {leg.why && <p className="leg-why">{leg.why}</p>}
          </div>
        )}
        {!readOnly &&
          (busy?.kind === "city" ? (
            <span className="thinking" role="status">
              <span className="dot" />
              Planning {leg.days} {leg.days === 1 ? "day" : "days"} in {busy.city} instead of {leg.city}…
            </span>
          ) : cityPick ? (
            <div className="leg-confirm" role="group" aria-label="Confirm the swap">
              <p>
                Swap {leg.city} for <b>{cityPick}</b>? Your {leg.days} {leg.days === 1 ? "day" : "days"} there
                {lockedHere ? `, including ${lockedHere} locked ${lockedHere === 1 ? "stop" : "stops"},` : ""} will be planned again
                {(it.hotels ?? []).some((h) => h.city === leg.city) ? ", with new hotels" : ""}.
              </p>
              <div className="row tight">
                <button type="button" className="btn small" onClick={() => swapCity(legIdx, cityPick)} disabled={!!busy}>
                  Swap to {cityPick}
                </button>
                <button type="button" className="btn ghost small" onClick={() => setCityPick(null)}>
                  Keep {leg.city}
                </button>
              </div>
            </div>
          ) : (
            <div className="leg-swap">
              <span className="label">
                <IconSwap /> Swap {leg.city} for
              </span>
              <div className="leg-alts">
                {swaps.map((a) => (
                  <button key={a.city} type="button" className="leg-alt" onClick={() => setCityPick(a.city)} disabled={!!busy}>
                    <b>{a.city}</b>
                    {a.why && <small>{a.why}</small>}
                  </button>
                ))}
                <button type="button" className="leg-alt other" aria-expanded={otherOpen} onClick={() => setOtherOpen((o) => !o)} disabled={!!busy}>
                  <b>Somewhere else</b>
                  <small>Type any town</small>
                </button>
              </div>
              {otherOpen && (
                <form
                  className="row tight leg-other"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const to = otherCity.trim();
                    if (to.length >= 2) setCityPick(to);
                  }}
                >
                  <input
                    type="text"
                    aria-label={`A town to visit instead of ${leg.city}`}
                    placeholder="e.g. a town nearby"
                    maxLength={80}
                    value={otherCity}
                    onChange={(e) => setOtherCity(e.target.value)}
                  />
                  <button className="btn small" type="submit" disabled={otherCity.trim().length < 2}>
                    Next
                  </button>
                </form>
              )}
            </div>
          ))}
      </section>
    ) : null;

  return (
    <article className="trip">
      {/* ---------- header ---------- */}
      <header className="hero">
        <span className="where-line">
          {city}
          {it.route && it.route.length > 1 ? ` · ${it.route.length} stops` : ""} · {it.days.length} {it.days.length === 1 ? "day" : "days"}
        </span>
        <h1>{it.title}</h1>
        {ideal && <IdealDays ideal={ideal} days={it.days.length} place={city} />}
        {/* Only when their own trips and ratings give a reason; never a general description. */}
        {isOwner && it.forYou ? (
          <p className="foryou-note trip-foryou">
            <b>For you</b> {it.forYou}
          </p>
        ) : null}
        {/* Owners get Save and Share (planning together and the calendar are in the share sheet). */}
        <div className="actions">
          {isOwner && (
            <button type="button" className="hbtn" aria-pressed={trip.saved} onClick={() => update({ saved: !trip.saved })}>
              <IconBookmark />
              {trip.saved ? "Saved" : "Save"}
            </button>
          )}
          {isOwner && (
            <button type="button" className="hbtn" onClick={() => shareDlg.current?.showModal()}>
              <IconShare />
              Share
            </button>
          )}
          {!readOnly && (togetherOn || isMember) && (
            <button type="button" className="hbtn" onClick={() => togDlg.current?.showModal()}>
              <IconPeople />
              {togetherOn ? `Planning with ${tog!.people.length - 1}` : "Plan together"}
            </button>
          )}
          {!isOwner && (
            <button type="button" className="hbtn" onClick={() => calDlg.current?.showModal()}>
              <IconCalendar />
              Add to calendar
            </button>
          )}
        </div>
      </header>

      {toolbar}

      {togetherOn && (
        <p className="together-note">
          <IconPeople />
          <span>
            {isMember ? `You're planning this with ${tog!.people.find((p) => p.owner)?.name ?? "a friend"}` : `You're planning this with ${tog!.people.filter((p) => !p.me).map((p) => p.name).join(", ")}`}.
          </span>
        </p>
      )}

      {/* ---------- route (several stops) ---------- */}
      {!!it.route && it.route.length > 1 && (
        <nav className="route" aria-label="Route">
          {it.route.map((l, i) => {
            const first = it.days.findIndex((x) => x.city === l.city);
            const hop = [l.transfer?.mode, l.transfer?.duration].filter(Boolean).join(" · ");
            return (
              <Fragment key={l.city + i}>
                {i > 0 && (
                  <span className="route-hop" aria-label={hop ? `then ${hop}` : "then"}>
                    <svg viewBox="0 0 24 8" aria-hidden="true"><path d="M0 4h21M18 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                    {hop && <small>{hop}</small>}
                  </span>
                )}
                <button
                  type="button"
                  className="route-stop"
                  aria-pressed={d.city === l.city}
                  onClick={() => {
                    if (first >= 0) setDay(first);
                    setSwapOpen(null);
                    setDayHintOpen(false);
                    setCityPick(null);
                    setOtherOpen(false);
                  }}
                >
                  <b>{l.city}</b>
                  <span>
                    {l.days} {l.days === 1 ? "day" : "days"}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </nav>
      )}
      {legCard}

      {/* ---------- day ---------- (tabs only when there's more than one) */}
      {it.days.length > 1 && (
      <div
        className="daytabs"
        role="tablist"
        aria-label="Days"
        onKeyDown={(e) => {
          // Arrow keys, Home and End move between days (one tab stop for the whole row).
          const last = it.days.length - 1;
          const to = e.key === "ArrowRight" ? Math.min(last, dIdx + 1) : e.key === "ArrowLeft" ? Math.max(0, dIdx - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
          if (to == null) return;
          e.preventDefault();
          pickDay(to);
          (e.currentTarget.children[to] as HTMLElement | undefined)?.focus();
        }}
      >
        {it.days.map((x, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            id={`daytab-${i}`}
            aria-selected={i === dIdx}
            aria-controls="day-panel"
            tabIndex={i === dIdx ? 0 : -1}
            onClick={() => pickDay(i)}
          >
            {x.label}
            {x.city && <small className="tab-city">{x.city}</small>}
          </button>
        ))}
      </div>
      )}

      <section
        className="card"
        id="day-panel"
        role={it.days.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={it.days.length > 1 ? `daytab-${dIdx}` : undefined}
        aria-label={it.days.length > 1 ? undefined : d.label}
      >
        {d.arrival && (
          <p className="arrival">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {d.arrival}
          </p>
        )}
        <div className="dayhead">
          <div className="dayhead-title">
            {d.city && <span className="eyebrow">{d.city}</span>}
            <h2>{d.theme}</h2>
          </div>
          <div className="daytools">
            <a className="btn ghost small" href={googleMapsDayUrl(d.stops, dayCity)} target="_blank" rel="noopener noreferrer">
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
              {togetherOn
                ? "Locked stops and ones anyone's in for stay put. The rest is replaced with picks for everyone's taste."
                : d.stops.some((s) => s.locked)
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
                    <PlacePhoto photo={s.place?.photos?.[0]} alt={s.name} onOpen={() => openGallery(s.name, s.place)} count={s.place?.photos?.length} />
                    <span className="tl-time">{s.time}</span>
                    <div className="tl-name">
                      {s.name} {s.neighborhood && <span className="hood">in {s.neighborhood}</span>}
                    </div>
                    <HotNow hot={s.hot} />
                    <p className="tl-why">{s.why}</p>
                    <Cost p={s} />
                    <ForYou p={s} />
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
                            disabled={!!busy}
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
                          {togetherOn && <WhoIsIn people={tog!.people} by={tog!.reactions[k]} />}
                          <button type="button" className="iconbtn up" aria-pressed={pressed(k, 1)} aria-label={togetherOn ? `I'm in: ${s.name}` : `Good pick: ${s.name}`} onClick={() => thumb(k, 1)}>
                            <IconUp />
                          </button>
                          <button type="button" className="iconbtn down" aria-pressed={pressed(k, -1)} aria-label={togetherOn ? `Pass: ${s.name}` : `Not for me: ${s.name}`} onClick={() => thumb(k, -1)}>
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
                            <b>{v === -1 || myReaction(k) === -1 ? "Not quite right? Swap it." : "Swap this stop"}</b>
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

      {/* ---------- going out (trips that asked for nightlife) ---------- */}
      {!readOnly && it.mode !== "multi" && (trip.request.interests?.includes("Nightlife") || trip.request.clubs) && (
        <GoingOut city={trip.request.destination || trip.destination} clubsFirst={!!trip.request.clubs} />
      )}

      {/* ---------- stays ---------- */}
      <section className="card">
        <div className="head">
          <h2>Where to stay</h2>
          {it.stayLabel && <span className="hint">Matching {it.stayLabel.replace(" · ", ", ")}</span>}
        </div>
        {it.hotels?.length ? (
          <>
            <div className="hotels">
              {it.hotels.map((h, i) => (
                <Fragment key={h.name + i}>
                {it.mode === "multi" && h.city && h.city !== it.hotels[i - 1]?.city && <h3 className="hotel-city">{h.city}</h3>}
                <div className="hotel">
                  {!!h.place?.photos?.length && (
                    <div className="hphotos">
                      {h.place.photos.slice(0, 3).map((ph, n) => (
                        <PlacePhoto
                          key={ph.name}
                          photo={ph}
                          alt={h.name}
                          className="pphoto hphoto"
                          sizes="(max-width: 720px) 80vw, 260px"
                          onOpen={() => openGallery(h.name, h.place, n)}
                          count={n === 0 ? h.place?.photos?.length : undefined}
                        />
                      ))}
                    </div>
                  )}
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
                  <ForYou p={h} />
                  {h.localTip && (
                    <p className="tip">
                      <b>Local tip</b> {h.localTip}
                    </p>
                  )}
                  <div className="tl-foot">
                    <span className="links">
                      <a href={ratesUrl(h, h.city ? `${h.city}, ${city}` : city)} target="_blank" rel="noopener noreferrer">
                        Check rates
                      </a>
                      {h.place?.mapsUrl && (
                        <a href={h.place.mapsUrl} target="_blank" rel="noopener noreferrer">
                          Map
                        </a>
                      )}
                      <Contact place={h.place} />
                    </span>
                    {!readOnly && (
                      <div className="tl-tools">
                        {togetherOn && <WhoIsIn people={tog!.people} by={tog!.reactions[`h-${i}`]} />}
                        <button type="button" className="iconbtn up" aria-pressed={pressed(`h-${i}`, 1)} aria-label={`Good pick: ${h.name}`} onClick={() => thumb(`h-${i}`, 1)}>
                          <IconUp />
                        </button>
                        <button type="button" className="iconbtn down" aria-pressed={pressed(`h-${i}`, -1)} aria-label={`Not for me: ${h.name}`} onClick={() => thumb(`h-${i}`, -1)}>
                          <IconDown />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                </Fragment>
              ))}
            </div>
            <p className="hint">
              {it.hotels.some((h) => h.liveRate)
                ? "Live rates are for your dates and can change. Other prices are typical nightly estimates."
                : "Prices are typical nightly estimates. Add travel dates for live rates where available."}
            </p>
            <Rentals trip={trip} startDate={stayStart} />
            {!readOnly && (
              <details className="more">
                <summary>Change hotel style or price</summary>
                {stayControls}
              </details>
            )}
          </>
        ) : (
          <>
            {!readOnly && stayControls}
            <Rentals trip={trip} startDate={stayStart} lead={readOnly ? "Find a place on Airbnb" : "Or rent a whole place"} />
          </>
        )}
      </section>

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
        {isOwner && (
          <div className="ratebar">
            <span className="label">Rate this plan</span>
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
            <Link className="went" href={`/profile?log=${trip.id}&city=${encodeURIComponent(city.split(",")[0]!.trim())}`} title="Add it to the places you've been">
              I went
            </Link>
          </div>
        )}
        <p className="hint">Check opening hours before you go.</p>
      </section>

      <p className={`toast${status ? " show" : ""}${status?.err ? " err" : ""}`} role="status" aria-live="polite">
        {status?.text}
      </p>

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
              <input id="share-on" type="checkbox" checked={!!trip.shareToken} disabled={!!busy} onChange={(e) => setShared(e.target.checked)} />
            </label>
            {shareNote && (
              <p className="status err" role="alert">
                {shareNote}
              </p>
            )}
            {shareUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="og-preview" src={`/t/${trip.shareToken}/opengraph-image`} alt="How the link looks when you send it" width={600} height={315} loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
                <div className="copyrow">
                  <input type="text" readOnly value={shareUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="btn ghost" onClick={() => copy(shareUrl)}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button type="button" className="btn" onClick={() => navigator.share({ title: it.title, url: shareUrl }).catch(() => {})}>
                    <IconShare />
                    Send the link
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
            <div className="share-more">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  shareDlg.current?.close();
                  togDlg.current?.showModal();
                }}
              >
                <IconPeople />
                {togetherOn ? `Planning with ${tog!.people.length - 1}` : "Plan together"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  shareDlg.current?.close();
                  calDlg.current?.showModal();
                }}
              >
                <IconCalendar />
                Add to calendar
              </button>
            </div>
            <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => shareDlg.current?.close()}>
              Done
            </button>
          </div>
        </dialog>
      )}

      {!readOnly && (
        <TogetherSheet
          ref={togDlg}
          tripId={trip.id}
          isOwner={isOwner}
          together={tog}
          onChange={setTog}
          onLeft={() => (window.location.href = "/trips")}
        />
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

      {gallery && <PhotoGallery target={gallery} onClose={() => setGallery(null)} />}
    </article>
  );
}
