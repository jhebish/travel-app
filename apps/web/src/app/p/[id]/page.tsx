"use client";
import { SIGNAL_KIND_LABELS, VISIBILITY_LABELS, countryName, flag, pastTripShownFrom, type PastTrip, type PersonDTO, type SignalKind, type Stop } from "@travel/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PersonLine } from "@/components/community";
import { DayMap } from "@/components/DayMap";
import { IconMap } from "@/components/icons";
import { PastTripShare, whenLabel } from "@/components/pages";
import { useMe } from "@/components/useMe";
import { api } from "@/lib/api";

interface LovedPlace {
  kind: SignalKind;
  name: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string;
}
interface PageData {
  trip: PastTrip;
  owner: PersonDTO | null;
  loved: LovedPlace[];
  isMe: boolean;
}

/** One past trip as its owner shares it: where, when (unless hidden), what they loved there. */
export default function PastTripPage({ params }: { params: { id: string } }) {
  const me = useMe();
  const [p, setP] = useState<PageData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (me === undefined) return; // wait for the session: followers and the owner see more
    api<PageData>(`/api/community/past/${params.id}`)
      .then(setP)
      .catch((e) => setErr((e as Error).message));
  }, [params.id, me]);

  // Every loved place goes to the map (it skips ones without coordinates), so its numbers match the list.
  const stops = useMemo(
    () => (p?.loved ?? []).map((l) => ({ name: l.name, lat: l.lat, lng: l.lng, time: "", neighborhood: "", why: "", localTip: "", source: "locals" }) as Stop),
    [p],
  );

  if (err)
    return (
      <div className="card empty">
        <b>{err}</b>
        <Link href="/">Browse trips</Link>
      </div>
    );
  if (!p) return <div className="card"><p className="hint">Loading…</p></div>;

  const t = p.trip;
  const when = whenLabel(t);
  const first = p.isMe ? "you" : (p.owner?.displayName.split(" ")[0] ?? "they");
  const located = p.loved.some((l) => l.lat != null && l.lng != null);
  const vis = t.visibility ?? "followers";
  const shownFrom = pastTripShownFrom(t);

  return (
    <div className="stack ptrip" style={{ gap: 20 }}>
      <div className="byline">
        {p.owner ? <PersonLine person={p.owner} /> : <span className="hint">Only you can open this page until you join the community.</span>}
        {p.isMe && (
          <Link className="btn ghost sm" href={`/profile?edit=${t.id}`}>
            Edit your trip
          </Link>
        )}
      </div>

      <section className="card stack">
        <div className="head">
          <span className="eyebrow">
            <span aria-hidden="true">{flag(t.countryCode)}</span> {[countryName(t.countryCode), when, t.days ? `${t.days} ${t.days === 1 ? "day" : "days"}` : ""].filter(Boolean).join(" · ")}
          </span>
          <h1>{t.city}</h1>
          {t.rating ? (
            <span className="ptrip-stars" aria-label={`Rated ${t.rating} of 5`}>
              {"★".repeat(t.rating)}
            </span>
          ) : null}
          {t.highlights && <p className="lede">{t.highlights}</p>}
        </div>
        {p.isMe && (
          <div className="ptrip-mine">
            <p className="hint">
              {vis === "private" ? "Only you can see this trip." : `${VISIBILITY_LABELS[vis]} can see this trip${t.hideDates ? ", without its dates" : ""}.`}
              {shownFrom && vis !== "private" ? " Others can open it once it's over." : ""}
            </p>
            <PastTripShare place={t} member={!!p.owner} onChange={(np) => setP({ ...p, trip: np })} />
          </div>
        )}
      </section>

      {p.loved.length > 0 ? (
        <section className="card stack">
          <h2>What {first} loved</h2>
          {located && <DayMap stops={stops} route={false} label={`Map of the places ${first} loved in ${t.city}`} />}
          <ol className="loved">
            {p.loved.map((l, i) => (
              <li key={`${l.name}-${i}`}>
                <span className="loved-n tabnum" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="loved-text">
                  <small>{SIGNAL_KIND_LABELS[l.kind]}</small>
                  <b>{l.name}</b>
                </span>
                <a className="btn ghost small" href={l.mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={`${l.name} on Google Maps`}>
                  <IconMap />
                  Map
                </a>
              </li>
            ))}
          </ol>
        </section>
      ) : p.isMe ? (
        <section className="card empty">
          <b>Add the places you loved in {t.city}</b>
          <span className="hint">Where you stayed, ate and went. They show here, on a map, for the people you share this with.</span>
          <Link href={`/profile?edit=${t.id}`}>Add what you loved</Link>
        </section>
      ) : null}

      <aside className="cta">
        <h2>Want a trip like this?</h2>
        <p className="lede">
          Pylos plans {t.city} around what {p.isMe ? "you loved last time" : `${first} loved`}, and what you&apos;re into.
        </p>
        <Link className="btn" href={`/plan?like=${t.id}`}>
          Plan a trip like this
        </Link>
      </aside>
    </div>
  );
}
