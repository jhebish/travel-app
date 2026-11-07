"use client";
import { MAX_PLACE_PHOTOS, type PlacePhoto as Photo } from "@travel/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconClose } from "./icons";
import { PhotoCredit, photoSrc } from "./PlacePhoto";

export interface GalleryTarget {
  title: string;
  placeId?: string;
  photos: Photo[];
  /** Which photo was tapped. */
  start?: number;
}

/**
 * A place's photos, one at a time at full size: swipe, use the arrows or the arrow keys.
 * Mounted when opened and unmounted on close. Trips built before galleries kept only a few
 * photos; for those it fetches the rest by place id.
 */
export function PhotoGallery({ target, onClose }: { target: GalleryTarget; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [photos, setPhotos] = useState(target.photos);
  const [index, setIndex] = useState(target.start ?? 0);

  // Open at the photo that was tapped, before the first paint.
  useLayoutEffect(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
    const t = track.current;
    if (t) t.scrollLeft = (target.start ?? 0) * t.clientWidth;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!target.placeId || target.photos.length >= MAX_PLACE_PHOTOS) return;
    let live = true;
    fetch(`/api/place-photos?id=${encodeURIComponent(target.placeId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ photos?: Photo[] }>) : null))
      .then((res) => {
        // The fresh list replaces the stored one: an old trip's photo names may have expired,
        // and Google lists photos in the same order, so the stored ones come first anyway.
        if (live && res?.photos && res.photos.length > target.photos.length) setPhotos(res.photos);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target]);

  const go = (n: number) => {
    const t = track.current;
    if (!t || !photos.length) return;
    const to = Math.max(0, Math.min(photos.length - 1, n));
    t.scrollTo({ left: to * t.clientWidth, behavior: "smooth" });
  };
  const close = () => dlg.current?.close();

  return (
    <dialog
      ref={dlg}
      className="gallery"
      aria-label={`Photos of ${target.title}`}
      onClose={onClose}
      onClick={(e) => e.target === dlg.current && close()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        go(index + (e.key === "ArrowRight" ? 1 : -1));
      }}
    >
      <div className="gallery-head">
        <b>{target.title}</b>
        {photos.length > 1 && (
          <span className="gallery-pos" aria-live="polite">
            {index + 1} of {photos.length}
          </span>
        )}
        <button type="button" className="gallery-close" aria-label="Close photos" onClick={close}>
          <IconClose />
        </button>
      </div>
      <div
        className="gallery-track"
        ref={track}
        onScroll={(e) => {
          const t = e.currentTarget;
          if (t.clientWidth) setIndex(Math.round(t.scrollLeft / t.clientWidth));
        }}
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {photos.map((p, n) => (
          <figure key={p.name} className="gallery-slide" onClick={(e) => e.target === e.currentTarget && close()}>
            <img
              src={photoSrc(p.name, 1200)}
              alt={`${target.title}, photo ${n + 1} of ${photos.length}`}
              loading={Math.abs(n - index) <= 1 ? "eager" : "lazy"}
              decoding="async"
            />
            {p.by && (
              <figcaption>
                <PhotoCredit photo={p} />
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" className="gallery-nav prev" aria-label="Previous photo" disabled={index === 0} onClick={() => go(index - 1)}>
            ‹
          </button>
          <button type="button" className="gallery-nav next" aria-label="Next photo" disabled={index >= photos.length - 1} onClick={() => go(index + 1)}>
            ›
          </button>
        </>
      )}
    </dialog>
  );
}
