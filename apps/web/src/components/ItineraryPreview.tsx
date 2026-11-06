"use client";
import type { Itinerary, Stop } from "@travel/core";
import { PlaceThumb } from "./PlacePhoto";

export interface PreviewDay {
  label: string;
  theme: string;
  city?: string;
  arrival?: string;
  /** Undefined while the day is still being planned. */
  stops?: Stop[];
}

/**
 * A light, read-only view of an itinerary: used while a trip is being built (days fill in as
 * they finish) and for sample itineraries on Browse.
 */
export function ItineraryPreview({
  days,
  route,
  maxStops,
  compact = false,
}: {
  days: PreviewDay[];
  route?: { city: string; days: number }[];
  maxStops?: number;
  compact?: boolean;
}) {
  return (
    <div className={`preview${compact ? " compact" : ""}`}>
      {route && route.length > 1 && (
        <p className="preview-route">
          {route.map((l, i) => (
            <span key={l.city + i}>
              {i > 0 && <span aria-hidden="true"> → </span>}
              <b>{l.city}</b> <small>{l.days}d</small>
            </span>
          ))}
        </p>
      )}
      <ol className="preview-days">
        {days.map((d, i) => (
          <li key={i} className={d.stops ? "ready" : "pending"}>
            <div className="preview-dayhead">
              <span className="eyebrow">
                {d.label}
                {d.city ? ` · ${d.city}` : ""}
              </span>
              <b>{d.theme}</b>
            </div>
            {d.stops ? (
              <ul className="preview-stops">
                {d.stops.slice(0, maxStops ?? d.stops.length).map((s, j) => (
                  <li key={s.name + j} className={s.place?.photos?.[0] ? "has-thumb" : undefined}>
                    <span className="preview-time">{s.time}</span>
                    <span>
                      <b>{s.name}</b>
                      {!compact && s.why ? <span className="preview-why"> {s.why}</span> : null}
                    </span>
                    <PlaceThumb photo={s.place?.photos?.[0]} alt="" />
                  </li>
                ))}
                {maxStops != null && d.stops.length > maxStops && <li className="preview-more">and {d.stops.length - maxStops} more</li>}
              </ul>
            ) : (
              <div className="preview-skel" aria-label="Planning this day">
                <span />
                <span />
                <span />
              </div>
            )}
          </li>
        ))}
      </ol>
      {days.some((d) => d.stops?.some((s) => s.place?.photos?.length)) && <p className="photo-credit">Photos: Google Maps contributors</p>}
    </div>
  );
}

export const previewFromItinerary = (it: Itinerary): PreviewDay[] => it.days.map((d) => ({ label: d.label, theme: d.theme, city: d.city, arrival: d.arrival, stops: d.stops }));
