"use client";
import { coordsOf, type Stop } from "@travel/core";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

/**
 * Map of one day's stops, numbered in order and joined by a line.
 * Tiles: OpenStreetMap by default (free, no key, attribution required; fine for modest traffic).
 * For production volume set NEXT_PUBLIC_MAP_TILE_URL (and NEXT_PUBLIC_MAP_ATTRIBUTION) to a keyed
 * provider such as MapTiler or Stadia. The tiles are muted in CSS to match the app's look.
 * Stops without coordinates are skipped.
 */
export function DayMap({ stops, onPick }: { stops: Stop[]; onPick?: (index: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const key = stops.map((s) => `${s.name}|${coordsOf(s)?.lat}|${s.locked}`).join(";");

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      const pts = stops
        .map((s, i) => ({ s, i, c: coordsOf(s) }))
        .filter((p): p is { s: Stop; i: number; c: NonNullable<ReturnType<typeof coordsOf>> } => !!p.c);
      if (!pts.length) return;
      map = L.map(el.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      const latlngs = pts.map((p) => [p.c.lat, p.c.lng] as [number, number]);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2f45d8";
      if (latlngs.length > 1) L.polyline(latlngs, { color: accent, weight: 3, opacity: 0.55, dashArray: "6 8" }).addTo(map);
      pts.forEach((p) => {
        const icon = L.divIcon({
          className: "",
          html: `<div class="pin${p.s.locked ? " locked" : ""}">${p.i + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const m = L.marker([p.c.lat, p.c.lng], { icon, title: p.s.name, keyboard: true }).addTo(map!);
        m.bindTooltip(p.s.name, { direction: "top", offset: [0, -14] });
        if (onPick) m.on("click", () => onPick(p.i));
      });
      if (latlngs.length === 1) map.setView(latlngs[0]!, 15);
      else map.fitBounds(L.latLngBounds(latlngs), { padding: [36, 36], maxZoom: 16 });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const hasCoords = stops.some((s) => coordsOf(s));
  if (!hasCoords) return null;
  return <div ref={el} className="map" role="img" aria-label="Map of this day's stops" />;
}
