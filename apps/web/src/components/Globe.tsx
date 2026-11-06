"use client";
import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";

export interface GlobeMarker {
  key: string;
  name: string;
  /** Second line for screen readers and the label, e.g. the country. */
  sub: string;
  lat: number;
  lng: number;
  /** 0–1: how hot the destination is right now (bigger pin). */
  heat: number;
}

type Rot = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Interpolate longitudes the short way round. */
const lerpAngle = (a: number, b: number, t: number) => a + ((((b - a + 540) % 360) - 180) * t);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * A slowly turning globe in the site's palette with a clickable pin per destination.
 * Drag to turn it; choosing a pin swings it to the front. Land comes from world-atlas (110m).
 */
export default function Globe({
  markers,
  selected,
  onSelect,
}: {
  markers: GlobeMarker[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const rotation = useRef<Rot>([-18, -24, 0]); // start over the Mediterranean
  const [, setFrame] = useState(0);
  const anim = useRef<{ from: Rot; to: Rot; start: number; dur: number } | null>(null);
  const drag = useRef<{ x: number; y: number; r: Rot; moved: boolean } | null>(null);
  const idleUntil = useRef(0);
  const hovering = useRef(false);
  const reduced = useRef(false);
  const colors = useRef({ ocean: "#cde3e2", land: "#d5e4c8", landLine: "#b5c8a6", grid: "#fffdf9", rim: "#e4d9cc" });
  const projection = useMemo(() => geoOrthographic().clipAngle(90).precision(0.6), []);

  // Land outlines, loaded only on this page.
  useEffect(() => {
    let alive = true;
    Promise.all([import("topojson-client"), import("world-atlas/land-110m.json")])
      .then(([topo, mod]) => {
        const world = ((mod as { default?: unknown }).default ?? mod) as Parameters<typeof topo.feature>[0] & { objects: { land: unknown } };
        const f = topo.feature(world, world.objects.land as Parameters<typeof topo.feature>[1]);
        if (alive) setLand(f as unknown as GeoPermissibleObjects);
      })
      .catch((e) => console.error("globe: land failed to load", e));
    return () => {
      alive = false;
    };
  }, []);

  // Square, as wide as its container.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Colors follow the theme (light and dark).
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
      colors.current = {
        ocean: v("--accent-soft", "#cde3e2"),
        land: v("--hero", "#d5e4c8"),
        landLine: v("--hero-line", "#b5c8a6"),
        grid: v("--surface", "#fffdf9"),
        rim: v("--line", "#e4d9cc"),
      };
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return () => mq.removeEventListener("change", read);
  }, []);

  // Swing the chosen destination to the front.
  useEffect(() => {
    const m = markers.find((x) => x.key === selected);
    if (!m) return;
    const to: Rot = [-m.lng, clamp(-m.lat, -65, 65), 0];
    if (reduced.current) {
      rotation.current = to;
      setFrame((f) => f + 1);
      return;
    }
    anim.current = { from: [...rotation.current] as Rot, to, start: performance.now(), dur: 900 };
    idleUntil.current = performance.now() + 8000;
  }, [selected, markers]);

  // Draw loop: only redraws when the globe actually moved.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const path = geoPath(projection, ctx);
    const grat = geoGraticule10();
    let raf = 0;
    let last = performance.now();
    let drawn = "";
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(64, now - last);
      last = now;
      const a = anim.current;
      if (a) {
        const t = Math.min(1, (now - a.start) / a.dur);
        const e = ease(t);
        rotation.current = [lerpAngle(a.from[0], a.to[0], e), a.from[1] + (a.to[1] - a.from[1]) * e, 0];
        if (t >= 1) anim.current = null;
      } else if (!drag.current && !hovering.current && !reduced.current && now > idleUntil.current) {
        rotation.current = [rotation.current[0] + dt * 0.005, rotation.current[1], 0];
      }
      const r = rotation.current;
      const sig = `${r[0].toFixed(2)}|${r[1].toFixed(2)}|${size}|${land ? 1 : 0}|${colors.current.ocean}`;
      if (sig !== drawn) {
        drawn = sig;
        projection.scale(size / 2 - 6).translate([size / 2, size / 2]).rotate(r);
        const col = colors.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        path({ type: "Sphere" });
        ctx.fillStyle = col.ocean;
        ctx.fill();
        ctx.beginPath();
        path(grat);
        ctx.strokeStyle = col.grid;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (land) {
          ctx.beginPath();
          path(land);
          ctx.fillStyle = col.land;
          ctx.fill();
          ctx.strokeStyle = col.landLine;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
        ctx.beginPath();
        path({ type: "Sphere" });
        ctx.strokeStyle = col.rim;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        setFrame((f) => (f + 1) % 1_000_000);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, land, projection]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, r: [...rotation.current] as Rot, moved: false };
    anim.current = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !size) return;
    const k = 200 / size;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    rotation.current = [d.r[0] + dx * k, clamp(d.r[1] - dy * k, -80, 80), 0];
  };
  const onPointerUp = () => {
    drag.current = null;
    idleUntil.current = performance.now() + 6000;
  };

  // Pin positions for this frame.
  if (size) projection.scale(size / 2 - 6).translate([size / 2, size / 2]).rotate(rotation.current);
  const center: [number, number] = [-rotation.current[0], -rotation.current[1]];
  const pins = size
    ? markers.map((m) => {
        const dist = geoDistance([m.lng, m.lat], center);
        const visible = dist < Math.PI / 2 - 0.06;
        const p = projection([m.lng, m.lat]) ?? [0, 0];
        const fade = clamp((Math.PI / 2 - dist) / 0.35, 0, 1);
        return { m, visible, x: p[0], y: p[1], fade };
      })
    : [];

  return (
    <div
      ref={wrap}
      className="globe"
      role="group"
      aria-label="Globe of trending destinations. Drag to turn it, or choose a destination."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => (hovering.current = true)}
      onPointerLeave={() => {
        hovering.current = false;
        onPointerUp();
      }}
      style={{ height: size || undefined }}
    >
      <canvas ref={canvas} aria-hidden="true" style={{ width: size, height: size }} />
      {pins.map(({ m, visible, x, y, fade }) => {
        const on = m.key === selected;
        const px = Math.round(18 + m.heat * 10);
        return (
          <button
            key={m.key}
            type="button"
            className={`pin-dest${on ? " on" : ""}`}
            style={{ left: x, top: y, opacity: visible ? fade : 0, visibility: visible ? "visible" : "hidden", width: px, height: px }}
            tabIndex={visible ? 0 : -1}
            aria-hidden={!visible}
            aria-pressed={on}
            aria-label={`${m.name}, ${m.sub}`}
            onClick={() => onSelect(m.key)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" />
              <rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
            <span className="pin-label">{m.name}</span>
          </button>
        );
      })}
    </div>
  );
}
