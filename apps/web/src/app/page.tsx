"use client";
import {
  DESTINATION_BY_KEY,
  DESTINATION_TAGS,
  dayRange,
  flag,
  monthsLabel,
  type BrowseDestination,
  type CommunityTrip,
  type Destination,
  type DestinationTag,
  type ForYouPick,
  type Itinerary,
} from "@travel/core";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TripCard } from "@/components/community";
import { DaysSlider } from "@/components/DaysSlider";
import { useDaysPlan } from "@/components/useDaysPlan";
import { ItineraryPreview, previewFromItinerary } from "@/components/ItineraryPreview";
import { useMe } from "@/components/useMe";
import { api } from "@/lib/api";

const Globe = dynamic(() => import("@/components/Globe"), {
  ssr: false,
  loading: () => <div className="globe globe-loading" aria-hidden="true" />,
});

type SampleState = { status: "ready"; itinerary: Itinerary } | { status: "pending" | "generating" | "failed" | "unavailable" };
interface Detail {
  destination: Destination;
  sample: SampleState;
  trips: CommunityTrip[];
}
interface ForYou {
  picks: ForYouPick[];
  placesLogged: number;
  needMore: boolean;
  member: boolean;
  signedIn: boolean;
}

const planHref = (d: Destination, days = d.sampleDays) =>
  `/plan?dest=${encodeURIComponent(d.kind === "region" ? d.name : `${d.name}, ${d.country}`)}&mode=${d.kind === "region" ? "multi" : "single"}&days=${days}`;

function DestinationPanel({ d, detail, sampleBusy }: { d: BrowseDestination; detail: Detail | null; sampleBusy: boolean }) {
  const sample = detail?.sample;
  const [days, setDays] = useState(d.sampleDays);
  useEffect(() => setDays(d.sampleDays), [d.key, d.sampleDays]);
  const plan = useDaysPlan(DESTINATION_BY_KEY[d.key] ?? null, sample?.status === "ready" ? sample.itinerary : null, days);
  const range = dayRange(d);
  return (
    <div className="dest">
      <div className="dest-head">
        <span className="eyebrow">
          <span aria-hidden="true">{flag(d.countryCode)}</span> {d.kind === "region" ? `Several stops · ${d.country}` : d.country}
        </span>
        <h2>{d.name}</h2>
        <div className="badges">
          {d.inSeason && <span className="badge season">In season now</span>}
          {d.trend && <span className="badge trend">{d.trend}</span>}
          {d.publicTrips > 0 && (
            <span className="badge">
              {d.publicTrips} {d.publicTrips === 1 ? "trip" : "trips"} on Pylos
            </span>
          )}
        </div>
      </div>
      <p className="dest-blurb">{d.blurb}</p>
      <p className="hint">Best months: {monthsLabel(d.bestMonths)}</p>

      <div className="dest-sample">
        {sample?.status === "ready" ? (
          <DaysSlider value={days} min={range.min} max={range.max} onChange={setDays} />
        ) : (
          <span className="label">
            {d.sampleDays} days in {d.name}
          </span>
        )}
        {sample?.status === "ready" && plan.itinerary ? (
          <>
            <ItineraryPreview days={previewFromItinerary(plan.itinerary)} route={plan.itinerary.route?.map((l) => ({ city: l.city, days: l.days }))} maxStops={3} compact />
            <Link className="linkbtn" href={`/d/${d.key}${days !== d.sampleDays ? `?days=${days}` : ""}`}>
              See the full itinerary →
            </Link>
          </>
        ) : sample?.status === "ready" && plan.failed ? (
          <p className="hint">We couldn&apos;t plan {days} days here just now. Try fewer days, or plan your own below.</p>
        ) : sample?.status === "unavailable" ? (
          <p className="hint">Itineraries for {d.name} are coming soon.</p>
        ) : sample?.status === "failed" && !sampleBusy ? (
          <p className="hint">We couldn&apos;t plan this one just now. Plan your own below.</p>
        ) : (
          <div className="dest-sketching">
            <span className="thinking">
              <span className="dot" />
              Planning {sample?.status === "ready" ? days : d.sampleDays} days in {d.name} with local picks…
            </span>
            <ItineraryPreview days={Array.from({ length: 3 }, (_, i) => ({ label: `Day ${i + 1}`, theme: "" }))} compact />
          </div>
        )}
      </div>

      <div className="row">
        <Link className="btn" href={planHref(d, days)}>
          Plan my own trip here
        </Link>
        {d.kind === "city" && (
          <Link className="btn ghost" href={`/plan?dest=${encodeURIComponent(d.country)}&mode=multi&days=7`}>
            Several stops in {d.country}
          </Link>
        )}
      </div>

      {!!detail?.trips.length && (
        <div className="stack" style={{ gap: 12 }}>
          <span className="label">Top trips from travelers</span>
          <div className="tgrid">
            {detail.trips.slice(0, 2).map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
          <Link className="linkbtn" href={`/friends?tab=top&city=${encodeURIComponent(d.name)}`}>
            All trips for {d.name}
          </Link>
        </div>
      )}
    </div>
  );
}

/** The home page. Rendered at build time (no search params), so the header and layout arrive as HTML. */
export default function Browse() {
  const me = useMe();
  const [dests, setDests] = useState<BrowseDestination[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tag, setTag] = useState<DestinationTag | "All">("All");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [forYou, setForYou] = useState<ForYou | null>(null);
  const requested = useRef(new Set<string>());
  const panelRef = useRef<HTMLDivElement>(null);

  // A destination in the link (/?d=kyoto) opens straight away.
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("d");
    if (d && DESTINATION_BY_KEY[d]) setSelected(d);
  }, []);

  useEffect(() => {
    api<{ destinations: BrowseDestination[] }>("/api/browse")
      .then((r) => setDests(r.destinations))
      .catch((e) => setErr((e as Error).message));
  }, []);

  useEffect(() => {
    if (!me?.user) return;
    api<ForYou>("/api/browse/foryou")
      .then(setForYou)
      .catch(() => {});
  }, [me?.user]);

  // Load the chosen destination; plan its sample the first time anyone opens it.
  useEffect(() => {
    if (!selected || !DESTINATION_BY_KEY[selected]) {
      setDetail(null);
      return;
    }
    let alive = true;
    let poll: ReturnType<typeof setTimeout> | null = null;
    const load = async (tries = 0) => {
      try {
        const d = await api<Detail>(`/api/browse/${selected}`);
        if (!alive) return;
        setDetail(d);
        const st = d.sample.status;
        if (st === "pending" || (st === "failed" && !requested.current.has(selected))) {
          if (requested.current.has(selected)) return;
          requested.current.add(selected);
          setSampleBusy(true);
          const { sample } = await api<{ sample: SampleState }>(`/api/browse/${selected}/sample`, { method: "POST" });
          if (!alive) return;
          setSampleBusy(false);
          if (sample.status === "ready") setDetail((x) => (x ? { ...x, sample } : x));
          else if (sample.status === "generating") poll = setTimeout(() => load(tries + 1), 4000);
          else setDetail((x) => (x ? { ...x, sample } : x));
        } else if (st === "generating" && tries < 30) {
          poll = setTimeout(() => load(tries + 1), 4000);
        }
      } catch {
        if (alive) setSampleBusy(false);
      }
    };
    void load();
    return () => {
      alive = false;
      if (poll) clearTimeout(poll);
      setSampleBusy(false);
    };
  }, [selected]);

  function choose(key: string, scroll = false) {
    setSelected(key);
    window.history.replaceState(null, "", `/?d=${key}`);
    if (scroll) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const shown = useMemo(() => (dests ?? []).filter((d) => tag === "All" || d.tags.includes(tag)), [dests, tag]);
  const markers = useMemo(() => {
    const max = Math.max(1, ...shown.map((d) => d.score));
    return shown.map((d) => ({ key: d.key, name: d.name, sub: d.country, lat: d.lat, lng: d.lng, heat: d.score / max }));
  }, [shown]);
  const current = dests?.find((d) => d.key === selected) ?? null;
  const signedOut = me !== undefined && !me.user;
  const member = !!forYou?.member;

  return (
    <div className="browse bleed">
      <header className="browse-head">
        <span className="eyebrow">Trips planned the local way</span>
        <h1>Where to next?</h1>
        <p className="lede">Turn the globe and tap a pin for an itinerary you can fit to your days, and the best-rated trips there. Pins are this season&apos;s trending places.</p>
        <div className="row browse-cta">
          <Link className="btn" href="/plan">
            Plan a trip
          </Link>
          <span className="hint">Know where you&apos;re going? Plan it around who&apos;s coming and what you love.</span>
        </div>
      </header>

      <div className="chips" role="group" aria-label="Filter by what you're into">
        {(["All", ...DESTINATION_TAGS] as const).map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(t)}>
            {t}
          </button>
        ))}
      </div>

      {err && <p className="status err">{err}</p>}

      <section className="browse-main">
        <div className="globe-col">
          <Globe markers={markers} selected={selected} onSelect={(k) => choose(k, window.innerWidth < 900)} />
          <p className="hint globe-hint">Drag to turn · pinch or + to zoom · tap a pin</p>
        </div>
        <aside className="card dest-panel" ref={panelRef} aria-live="polite">
          {current ? (
            <DestinationPanel d={current} detail={detail?.destination.key === current.key ? detail : null} sampleBusy={sampleBusy} />
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              <span className="eyebrow">Trending this month</span>
              <h2>Pick a place to start</h2>
              <ol className="hotlist">
                {(dests ?? []).slice(0, 6).map((d, i) => (
                  <li key={d.key}>
                    <button type="button" onClick={() => choose(d.key)}>
                      <span className="hot-rank">{i + 1}</span>
                      <span>
                        <b>{d.name}</b>
                        <small>
                          {d.country}
                          {d.inSeason ? " · in season" : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </section>

      {/* For you: predictions from logged places, or an invitation to log them. */}
      {signedOut ? (
        <section className="callout row between">
          <span>
            <b>Want destinations picked for you?</b>{" "}
            <span className="hint">Create a free account and log a few places you&apos;ve been. Pylos learns your taste and predicts where you&apos;ll love next.</span>
          </span>
          <Link className="btn sm" href="/login?next=/profile">
            Sign up free
          </Link>
        </section>
      ) : member && forYou && forYou.picks.length > 0 ? (
        <section className="card foryou">
          <div className="head">
            <span className="eyebrow">Picked for you</span>
            <h2>Where you&apos;ll probably love next</h2>
            <p className="hint">Based on the {forYou.placesLogged} places you&apos;ve logged.</p>
          </div>
          <div className="foryou-grid">
            {forYou.picks.map((p) => {
              const d = DESTINATION_BY_KEY[p.key];
              if (!d) return null;
              return (
                <button key={p.key} type="button" className="foryou-card" onClick={() => choose(p.key, true)}>
                  <span className="eyebrow">
                    <span aria-hidden="true">{flag(d.countryCode)}</span> {d.country}
                  </span>
                  <b>{d.name}</b>
                  <span>{p.why}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : forYou?.signedIn && forYou.needMore ? (
        <section className="callout row between">
          <span>
            <b>Get destinations picked for you.</b>{" "}
            <span className="hint">
              Log {Math.max(1, 2 - forYou.placesLogged)} more {2 - forYou.placesLogged === 1 ? "place" : "places"} you&apos;ve been and Pylos will predict where you&apos;ll love next.
            </span>
          </span>
          <Link className="btn sm" href="/profile">
            Log places
          </Link>
        </section>
      ) : null}

      <section className="stack" style={{ gap: 14 }}>
        <div className="head">
          <h2>Trending now</h2>
          <p className="hint">In season this month, named on 2026 trend lists, or popular on Pylos.</p>
        </div>
        <div className="destgrid">
          {shown.map((d) => (
            <button key={d.key} type="button" className={`destcard${d.key === selected ? " on" : ""}`} onClick={() => choose(d.key, true)}>
              <span className="eyebrow">
                <span aria-hidden="true">{flag(d.countryCode)}</span> {d.kind === "region" ? `${d.country} · several stops` : d.country}
              </span>
              <b>{d.name}</b>
              <span className="destcard-blurb">{d.blurb}</span>
              <span className="destcard-foot">
                {d.inSeason ? <span className="badge season">In season</span> : <span className="hint">Best {monthsLabel(d.bestMonths)}</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      {(signedOut || (me?.user?.isGuest && !member)) && (
        <aside className="cta signup">
          <span className="eyebrow">Free account</span>
          <h2>Let your past trips plan the next one</h2>
          <p className="lede">Log the places you&apos;ve been and what you loved. Pylos learns your taste, predicts where you&apos;ll love next, and plans it in seconds, with the places locals actually go.</p>
          <div className="row">
            <Link className="btn" href="/login?next=/profile">
              Sign up free
            </Link>
            <Link className="btn ghost" href="/plan">
              Plan a trip without an account
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}
