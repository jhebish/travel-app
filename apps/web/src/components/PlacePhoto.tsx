"use client";
import type { PlacePhoto as Photo } from "@travel/core";
import { useState } from "react";

export const photoSrc = (ref: string, w: number) => `/api/photo?ref=${encodeURIComponent(ref)}&w=${w}`;

/**
 * A Google Maps photo of a place, with its author credited (Google requires the credit).
 * Lazy-loaded with a fixed shape so the page doesn't jump; disappears quietly if it can't load.
 */
export function PlacePhoto({ photo, alt, className = "pphoto", sizes = "(max-width: 720px) 92vw, 200px", credit = true }: { photo?: Photo; alt: string; className?: string; sizes?: string; credit?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return null;
  return (
    <figure className={className}>
      <img
        src={photoSrc(photo.name, 400)}
        srcSet={`${photoSrc(photo.name, 400)} 400w, ${photoSrc(photo.name, 800)} 800w`}
        sizes={sizes}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {credit && photo.by && (
        <figcaption>
          {photo.byUrl ? (
            <a href={photo.byUrl} target="_blank" rel="noopener noreferrer">
              {photo.by}
            </a>
          ) : (
            photo.by
          )}{" "}
          · Google Maps
        </figcaption>
      )}
    </figure>
  );
}

/** A small square thumbnail for lists (no caption; the full photo on the trip page carries it). */
export function PlaceThumb({ photo, alt }: { photo?: Photo; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return null;
  return (
    <img
      className="pthumb"
      src={photoSrc(photo.name, 160)}
      width={44}
      height={44}
      alt={alt}
      title={photo.by ? `Photo: ${photo.by} · Google Maps` : undefined}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
