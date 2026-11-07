"use client";
import { DESTINATION_BY_KEY, dayRange, flag, monthsLabel, type CommunityTrip, type Itinerary } from "@travel/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TripCard } from "@/components/community";
import { DaysSlider } from "@/components/DaysSlider";
import { readOnlyTrip } from "@/components/readOnlyTrip";
import { TripView } from "@/components/TripView";
import { useDaysPlan } from "@/components/useDaysPlan";
import { api } from "@/lib/api";
import { planHref } from "@/lib/links";

type Plan = { status: "ready"; itinerary: Itinerary } | { status: "pending" | "generating" | "failed" | "unavailable" };

/** A destination's itinerary, open to everyone: fit it to your days, or plan your own. */
export default function DestinationTrip({ dkey }: { dkey: string }) {
  const d = DESTINATION_BY_KEY[dkey]!;
  const range = dayRange(d);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [trips, setTrips] = useState<CommunityTrip[]>([]);
  const [days, setDays] = useState(d.sampleDays);

  // A length in the link (/d/kyoto?days=5) from the slider on Browse.
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("days"));
    if (n >= range.min && n <= range.max) setDays(n);
  }, [range.min, range.max]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (tries = 0) => {
      const r = await api<{ sample: Plan; trips: CommunityTrip[] }>(`/api/browse/${dkey}`).catch(() => null);
      if (!alive) return;
      if (!r) return setPlan({ status: "failed" });
      setTrips(r.trips);
      setPlan(r.sample);
      if (r.sample.status === "pending" && tries === 0) {
        const p = await api<{ sample: Plan }>(`/api/browse/${dkey}/sample`, { method: "POST" }).catch(() => null);
        if (!alive) return;
        if (!p) return setPlan({ status: "failed" });
        setPlan(p.sample);
        if (p.sample.status === "generating") timer = setTimeout(() => load(tries + 1), 4000);
      } else if (r.sample.status === "generating") {
        // Polling that runs out ends as failed, not as a spinner that never stops.
        if (tries < 30) timer = setTimeout(() => load(tries + 1), 4000);
        else setPlan({ status: "failed" });
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [dkey]);

  const fitted = useDaysPlan(d, plan?.status === "ready" ? plan.itinerary : null, days);
  const where = d.kind === "region" ? d.name : `${d.name}, ${d.country}`;
  const trip = useMemo(
    () => (fitted.itinerary ? readOnlyTrip({ destination: where, title: fitted.itinerary.title, itinerary: fitted.itinerary }) : null),
    [fitted.itinerary, where],
  );
  const planLink = planHref(where, { multi: d.kind === "region", days });
  const slider = (
    <section className="card days-card">
      <DaysSlider
        value={days}
        min={range.min}
        max={range.max}
        onChange={setDays}
        note={fitted.planning ? `Planning ${days} days in ${d.name}… (once, then it's instant for everyone)` : undefined}
      />
    </section>
  );

  return (
    <>
      <div className="byline">
        <span className="hint">
          <Link href={`/?d=${d.key}`}>← Browse</Link> · <span aria-hidden="true">{flag(d.countryCode)}</span> {d.name} · best {monthsLabel(d.bestMonths)}
        </span>
        <Link className="btn sm" href={planLink}>
          Plan my own version
        </Link>
      </div>
      {trip ? (
        <TripView trip={trip} readOnly toolbar={slider} />
      ) : (
        <>
          {plan?.status === "ready" && slider}
          <section className="card">
            {plan?.status === "failed" || plan?.status === "unavailable" || fitted.failed ? (
              // A failure isn't shown with the "working" dot: it isn't going to finish on its own.
              <p className="status">
                {fitted.failed ? `We couldn't plan ${days} days here just now. Try fewer days, or ` : "This itinerary isn't ready yet. "}
                <Link href={planLink}>plan your own version</Link>.
              </p>
            ) : (
              <span className="thinking">
                <span className="dot" />
                Planning {days} days in {d.name} with local picks…
              </span>
            )}
          </section>
        </>
      )}
      {trips.length > 0 && (
        <section className="stack" style={{ gap: 12 }}>
          <h2>Trips travelers loved in {d.name}</h2>
          <div className="tgrid">
            {trips.slice(0, 4).map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        </section>
      )}
      <aside className="cta">
        <h2>Want your own version?</h2>
        <p className="lede">Tell Pylos who&apos;s coming and what you&apos;re into. Free, and it takes about a minute.</p>
        <div className="row">
          <Link className="btn" href={planLink}>
            Plan my own version
          </Link>
        </div>
      </aside>
    </>
  );
}
