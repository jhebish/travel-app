"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { OwnRanker, TripRanker } from "@/components/Rank";
import { useMe } from "@/components/useMe";

/**
 * "Which did you love more?"
 *   /rank                  your places (stays with stays, restaurants with restaurants…)
 *   /rank?kind=trip        your past trips against each other
 *   /rank?trip=<id>        the places of one past trip
 *   /rank?plan=<id>        a Pylos trip's stops and hotels, after it (with friends: the group's favourites)
 */
function RankPage() {
  const params = useSearchParams();
  const router = useRouter();
  const me = useMe();
  const plan = params.get("plan");
  const trip = params.get("trip");
  const kind = params.get("kind") === "trip" && !trip ? "trip" : "place";

  if (me === undefined)
    return (
      <span className="thinking">
        <span className="dot" />
        Loading…
      </span>
    );
  if (!me.user)
    return (
      <div className="card empty">
        <b>Sign in to rank your places</b>
        <Link href={`/login?next=${encodeURIComponent(`/rank${params.toString() ? `?${params}` : ""}`)}`}>Sign in</Link>
      </div>
    );

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="head">
        <span className="eyebrow">Which did you love more?</span>
        <h1>{plan ? "Rank the trip" : kind === "trip" ? "Rank your trips" : "Rank your places"}</h1>
        <p className="lede">Tap the one you loved more. Five quick answers and Pylos knows your favourites.</p>
      </div>
      {!plan && !trip && (
        <div className="seg" role="tablist" aria-label="What to rank">
          <button type="button" role="tab" aria-selected={kind === "place"} onClick={() => router.replace("/rank", { scroll: false })}>
            Places
          </button>
          <button type="button" role="tab" aria-selected={kind === "trip"} onClick={() => router.replace("/rank?kind=trip", { scroll: false })}>
            Trips
          </button>
        </div>
      )}
      {plan ? (
        <section className="card">
          <TripRanker tripId={plan} />
          <Link href={`/trips/${plan}`}>Open the trip</Link>
        </section>
      ) : (
        <OwnRanker key={`${kind}:${trip ?? ""}`} kind={kind} trip={trip} />
      )}
      {trip && <Link href="/rank">Rank all your places</Link>}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <RankPage />
    </Suspense>
  );
}
