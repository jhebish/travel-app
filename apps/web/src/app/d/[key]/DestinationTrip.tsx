"use client";
import { DESTINATION_BY_KEY, PARTIES, TripRequestSchema, flag, monthsLabel, type CommunityTrip, type Itinerary, type Trip } from "@travel/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TripCard } from "@/components/community";
import { TripView } from "@/components/TripView";
import { api } from "@/lib/api";

type SampleState = { status: "ready"; itinerary: Itinerary } | { status: "pending" | "generating" | "failed" | "unavailable" };

/** A destination's sample itinerary, open to everyone, with a nudge to plan your own. */
export default function DestinationTrip({ dkey }: { dkey: string }) {
  const d = DESTINATION_BY_KEY[dkey]!;
  const [sample, setSample] = useState<SampleState | null>(null);
  const [trips, setTrips] = useState<CommunityTrip[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (tries = 0) => {
      const r = await api<{ sample: SampleState; trips: CommunityTrip[] }>(`/api/browse/${dkey}`).catch(() => null);
      if (!alive || !r) return;
      setTrips(r.trips);
      setSample(r.sample);
      if (r.sample.status === "pending" && tries === 0) {
        const p = await api<{ sample: SampleState }>(`/api/browse/${dkey}/sample`, { method: "POST" }).catch(() => null);
        if (!alive || !p) return;
        setSample(p.sample);
        if (p.sample.status === "generating") timer = setTimeout(() => load(tries + 1), 4000);
      } else if (r.sample.status === "generating" && tries < 30) {
        timer = setTimeout(() => load(tries + 1), 4000);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [dkey]);

  const trip: Trip | null = useMemo(() => {
    if (sample?.status !== "ready") return null;
    return {
      id: "",
      createdAt: new Date().toISOString(),
      destination: d.kind === "region" ? d.name : `${d.name}, ${d.country}`,
      title: sample.itinerary.title,
      request: TripRequestSchema.parse({
        mode: d.kind === "region" ? "multi" : "single",
        destination: d.name,
        days: d.sampleDays,
        party: (PARTIES as readonly string[]).includes("Couple") ? "Couple" : "Solo",
        budget: "Mid-range",
        pace: "Balanced",
      }),
      weights: {} as Trip["weights"],
      customMix: false,
      itinerary: sample.itinerary,
      saved: false,
      rating: 0,
      votes: {},
    };
  }, [sample, d]);

  const planHref = `/?dest=${encodeURIComponent(d.kind === "region" ? d.name : `${d.name}, ${d.country}`)}&mode=${d.kind === "region" ? "multi" : "single"}&days=${d.sampleDays}`;

  return (
    <>
      <div className="byline">
        <span className="hint">
          <Link href={`/browse?d=${d.key}`}>← Browse</Link> · <span aria-hidden="true">{flag(d.countryCode)}</span> Sample {d.kind === "region" ? "route" : "itinerary"} for {d.name} · best {monthsLabel(d.bestMonths)}
        </span>
        <Link className="btn sm" href={planHref}>
          Make it mine
        </Link>
      </div>
      {trip ? (
        <TripView trip={trip} readOnly />
      ) : (
        <section className="card">
          <span className="thinking">
            <span className="dot" />
            {sample?.status === "failed" || sample?.status === "unavailable" ? "This sample isn't ready yet. Plan your own instead." : `Sketching a sample ${d.sampleDays}-day trip with local picks…`}
          </span>
        </section>
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
          <Link className="btn" href={planHref}>
            Plan my trip to {d.name}
          </Link>
          <Link className="btn ghost" href="/login?next=/profile">
            Create a free account
          </Link>
        </div>
      </aside>
    </>
  );
}
