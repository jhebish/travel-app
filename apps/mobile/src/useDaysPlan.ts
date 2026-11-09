import { fitItineraryToDays, type Destination, type Itinerary } from "@travel/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

export type Plan = { status: "ready"; itinerary: Itinerary } | { status: "pending" | "generating" | "failed" | "unavailable" };

/**
 * The itinerary to show for `days` on a destination, as on the site: the usual plan trimmed to
 * fit, or (for more days than it has) the longer version, planned once for everyone and trimmed
 * the same way. `planning` is true while that longer version is being planned.
 */
export function useDaysPlan(d: Destination | null, base: Itinerary | null, days: number) {
  const [long, setLong] = useState<Plan | null>(null);
  const asked = useRef<string | null>(null);
  const baseDays = base?.days.length ?? 0;
  const wantLong = !!d && !!base && days > baseDays;

  useEffect(() => {
    setLong(null);
    asked.current = null;
  }, [d?.key]);

  useEffect(() => {
    if (!wantLong || !d || asked.current === d.key) return;
    asked.current = d.key;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Every way this can stall ends as "failed", so the screen says so instead of planning forever.
    const load = async (tries = 0): Promise<void> => {
      const r = await api<{ sample: Plan }>(`/api/browse/${d.key}?long=1`).catch(() => null);
      if (!alive) return;
      if (!r) return setLong({ status: "failed" });
      setLong(r.sample);
      if (r.sample.status === "pending" || (r.sample.status === "failed" && tries === 0)) {
        setLong({ status: "generating" });
        const p = await api<{ sample: Plan }>(`/api/browse/${d.key}/sample?long=1`, { method: "POST" }).catch(() => null);
        if (!alive) return;
        if (p?.sample.status === "generating") timer = setTimeout(() => load(tries + 1), 4000);
        else setLong(p?.sample ?? { status: "failed" });
      } else if (r.sample.status === "generating") {
        if (tries < 40) timer = setTimeout(() => load(tries + 1), 4000);
        else setLong({ status: "failed" });
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [wantLong, d]);

  const itinerary = useMemo(() => {
    if (!base) return null;
    if (!wantLong) return fitItineraryToDays(base, days);
    return long?.status === "ready" ? fitItineraryToDays(long.itinerary, days) : null;
  }, [base, wantLong, long, days]);

  return {
    itinerary,
    planning: wantLong && (!long || long.status === "generating" || long.status === "pending"),
    failed: wantLong && (long?.status === "failed" || long?.status === "unavailable"),
  };
}
