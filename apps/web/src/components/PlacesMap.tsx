"use client";
import { countryName, flag, mapCentre, type PlacePoint } from "@travel/core";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

// Drawn on a canvas in the browser only, as on Browse.
const Globe = dynamic(() => import("./Globe"), { ssr: false, loading: () => <div className="globe globe-loading" aria-hidden="true" /> });

/**
 * Places you've been, on the globe: a pin per city (bigger where you've been back), and when you
 * went for the one chosen. `version` reloads it after places are added or removed.
 */
export function PlacesMap({ version }: { version: string }) {
  const [points, setPoints] = useState<PlacePoint[] | null>(null);
  const [pending, setPending] = useState(0);
  const [pin, setPin] = useState<string | null>(null);
  useEffect(() => {
    api<{ points: PlacePoint[]; pending: number }>("/api/community/places/map")
      .then((r) => {
        setPoints(r.points);
        setPending(r.pending);
      })
      .catch(() => setPoints(null));
  }, [version]);
  // Pins grow with trips back; it faces the side of the world with most of them.
  const most = Math.max(1, ...(points ?? []).map((p) => p.trips));
  const markers = useMemo(
    () => (points ?? []).map((p) => ({ key: p.key, name: p.city, sub: countryName(p.countryCode), lat: p.lat, lng: p.lng, heat: most > 1 ? (p.trips - 1) / (most - 1) : 0.4 })),
    [points, most],
  );
  const facing = useMemo(() => mapCentre((points ?? []).map((p) => ({ lat: p.lat, lng: p.lng, weight: p.trips }))), [points]);
  if (!points?.length) return null;
  const chosen = points.find((p) => p.key === pin);
  return (
    <div className="places-map">
      <Globe
        markers={markers}
        selected={pin}
        onSelect={setPin}
        facing={facing}
        still
        label="Globe of the places you've been. Drag to turn it, pinch or use the buttons to zoom, or choose a place."
      />
      <p className="hint" aria-live="polite">
        {chosen
          ? `${flag(chosen.countryCode)} ${chosen.city}, ${countryName(chosen.countryCode)} · ${chosen.trips} ${chosen.trips === 1 ? "trip" : "trips"}${chosen.years.length ? ` · ${chosen.years.join(", ")}` : ""}`
          : `${points.length} ${points.length === 1 ? "place" : "places"} on the map. Choose a pin to see when you went${most > 1 ? "; bigger pins are places you've been back to" : ""}.${pending ? ` ${pending} more will show up next time you open this.` : ""}`}
      </p>
    </div>
  );
}
