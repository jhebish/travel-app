"use client";
import type { PlacePhoto as Photo } from "@travel/core";
import { useState } from "react";
import { IconPhotos } from "./icons";

export const photoSrc = (ref: string, w: number) => `/api/photo?ref=${encodeURIComponent(ref)}&w=${w}`;

/** Google requires each photo's author to be credited wherever it's shown. */
export function PhotoCredit({ photo }: { photo: Photo }) {
  if (!photo.by) return null;
  return (
    <>
      {photo.byUrl ? (
        <a href={photo.byUrl} target="_blank" rel="noopener noreferrer">
          {photo.by}
        </a>
      ) : (
        photo.by
      )}{" "}
      · Google Maps
    </>
  );
}

/**
 * A Google Maps photo of a place, with its author credited (Google requires the credit).
 * Lazy-loaded with a fixed shape so the page doesn't jump; disappears quietly if it can't load.
 * With `onOpen`, tapping it opens the place's photo gallery.
 */
export function PlacePhoto({
  photo,
  alt,
  className = "pphoto",
  sizes = "(max-width: 720px) 92vw, 200px",
  credit = true,
  onOpen,
  count,
}: {
  photo?: Photo;
  alt: string;
  className?: string;
  sizes?: string;
  credit?: boolean;
  onOpen?: () => void;
  /** How many photos the gallery has, shown on the badge. */
  count?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return null;
  const img = (
    <img
      src={photoSrc(photo.name, 400)}
      srcSet={`${photoSrc(photo.name, 400)} 400w, ${photoSrc(photo.name, 800)} 800w`}
      sizes={sizes}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
  return (
    <figure className={className}>
      {onOpen ? (
        <button type="button" className="pphoto-open" onClick={onOpen} aria-label={`See photos of ${alt}`}>
          {img}
          <span className="pphoto-count" aria-hidden="true">
            <IconPhotos />
            {count && count > 1 ? count : null}
          </span>
        </button>
      ) : (
        img
      )}
      {credit && photo.by && (
        <figcaption>
          <PhotoCredit photo={photo} />
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
