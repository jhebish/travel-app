"use client";
import { fitItineraryToDays, type Trip } from "@travel/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DaysSlider } from "./DaysSlider";
import { TripView } from "./TripView";
import { planHref } from "@/lib/links";

/**
 * A shared trip the person who opened it can fit to their own days: slide down and it keeps
 * whole days (and the first stops of a route); for more days, plan their own version.
 */
export function ResizableTrip({ trip }: { trip: Trip }) {
  const total = trip.itinerary.days.length;
  const [days, setDays] = useState(total);
  const shown = useMemo(() => ({ ...trip, itinerary: fitItineraryToDays(trip.itinerary, days) }), [trip, days]);
  const multi = trip.itinerary.mode === "multi";
  const more = planHref(trip.destination, { multi, days: total + 2 });
  return (
    <TripView
      trip={shown}
      readOnly
      toolbar={
        total > 1 ? (
          <section className="card days-card">
            <DaysSlider
              value={days}
              min={1}
              max={total}
              onChange={setDays}
              note={
                days < total ? (
                  `Fitted to ${days} ${days === 1 ? "day" : "days"}: whole days kept${multi ? ", first stops on the route" : ""}.`
                ) : (
                  <>
                    Have more time? <Link href={more}>Plan a longer version →</Link>
                  </>
                )
              }
            />
          </section>
        ) : undefined
      }
    />
  );
}
