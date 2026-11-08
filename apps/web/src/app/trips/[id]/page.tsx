"use client";
import Link from "next/link";
import type { Together } from "@travel/core";
import { useEffect, useState } from "react";
import { TripFriends } from "@/components/Friends";
import { TripView } from "@/components/TripView";
import { api } from "@/lib/api";
import type { Trip } from "@/lib/trips";

export default function TripPage({ params }: { params: { id: string } }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [together, setTogether] = useState<Together | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ trip: Trip; together: Together | null }>(`/api/trips/${params.id}`)
      .then((r) => {
        setTogether(r.together);
        setTrip(r.trip);
      })
      .catch((e) => setError((e as Error).message));
  }, [params.id]);
  return (
    <>
      <div className="row">
        <Link href="/trips">Back to My trips</Link>
        {trip && trip.role !== "member" && <Link href={`/plan?from=${trip.id}`}>Plan again</Link>}
      </div>
      {error ? (
        <div className="card">
          <p className="status err">{error}</p>
        </div>
      ) : trip ? (
        <>
          <TripView trip={trip} together={together} />
          {trip.role !== "member" && <TripFriends trip={trip} />}
        </>
      ) : (
        <span className="thinking">
          <span className="dot" />
          Loading trip…
        </span>
      )}
    </>
  );
}
