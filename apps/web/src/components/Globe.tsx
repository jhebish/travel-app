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
interface View {
  rot: Rot;
  zoom: number;
}
type Gesture = { kind: "drag"; x: number; y: number; rot: Rot; moved: boolean } | { kind: "pinch"; dist: number; zoom: number };

const MAX_ZOOM = 8;
/** Pins closer than this (px) merge into one numbered cluster. */
const CLUSTER_PX = 24;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Interpolate longitudes the short way round. */
const lerpAngle = (a: number, b: number, t: number) => a + ((((b - a + 540) % 360) - 180) * t);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * A slowly turning globe in the site's palette with a pin per destination. Drag to turn it,
 * pinch or use the buttons to zoom, tap a numbered cluster to zoom into it. Pins are positioned
 * directly in the DOM each frame (no React re-render per frame), and the globe stops turning
 * while it's off screen. Land comes from world-atlas (110m).
 */
export default function Globe({
  markers,
  selected,
  onSelect,
  label = "Globe of trending destinations. Drag to turn it, pinch or use the buttons to zoom, or choose a destination.",
  facing,
  still = false,
}: {
  markers: GlobeMarker[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** What screen readers hear for the globe as a whole. */
  label?: string;
  /** Where it faces first; over the Mediterranean unless given. */
  facing?: { lat: number; lng: number } | null;
  /** Starts without turning (the play button turns it). */
  still?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pinEls = useRef(new Map<string, HTMLButtonElement>());
  const [size, setSize] = useState(0);
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const view = useRef<View>({ rot: facing ? [-facing.lng, clamp(-facing.lat, -75, 75), 0] : [-18, -24, 0], zoom: 1 });
  const anim = useRef<{ from: View; to: View; start: number; dur: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const idleUntil = useRef(0);
  const hovering = useRef(false);
  const focused = useRef(false);
  const [paused, setPaused] = useState(still);
  const pausedRef = useRef(still);
  pausedRef.current = paused;
  const onScreen = useRef(true);
  /** What each pin last showed, so a frame only touches what changed (position always does). */
  const pinState = useRef(new Map<string, string>());
  const reduced = useRef(false);
  const redraw = useRef(true);
  /** For each visible pin: the key of the pin it is drawn under (itself when it's shown). */
  const clusterOf = useRef(new Map<string, string>());
  const colors = useRef({ ocean: "#cde3e2", land: "#d5e4c8", landLine: "#b5c8a6", grid: "#fffdf9", rim: "#e4d9cc" });
  const projection = useMemo(() => geoOrthographic().clipAngle(90).precision(0.6), []);
  const latest = useRef({ markers, selected });
  latest.current = { markers, selected };

  // Land outlines, loaded only on this page.
  useEffect(() => {
    let alive = true;
    Promise.all([import("topojson-client"), import("world-atlas/land-110m.json")])
      .then(([topo, mod]) => {
        const world = ((mod as { default?: unknown }).default ?? mod) as Parameters<typeof topo.feature>[0] & { objects: { land: unknown } };
        const f = topo.feature(world, world.objects.land as Parameters<typeof topo.feature>[1]);
        if (alive) {
          setLand(f as unknown as GeoPermissibleObjects);
          redraw.current = true;
        }
      })
      .catch((e) => console.error("globe: land failed to load", e));
    return () => {
      alive = false;
    };
  }, []);

  // Square, as wide as its container; pause when scrolled out of view.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize(Math.floor(entry!.contentRect.width));
      redraw.current = true;
    });
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => (onScreen.current = !!entry?.isIntersecting));
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
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
      redraw.current = true;
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return () => mq.removeEventListener("change", read);
  }, []);

  function goTo(to: View, dur = 900) {
    to = { rot: [to.rot[0], clamp(to.rot[1], -75, 75), 0], zoom: clamp(to.zoom, 1, MAX_ZOOM) };
    setZoomed(to.zoom > 1.05);
    if (reduced.current) {
      view.current = to;
      redraw.current = true;
      return;
    }
    anim.current = { from: { rot: [...view.current.rot] as Rot, zoom: view.current.zoom }, to, start: performance.now(), dur };
    idleUntil.current = performance.now() + 8000;
  }

  // Swing the chosen destination to the front.
  useEffect(() => {
    const m = markers.find((x) => x.key === selected);
    if (m) goTo({ rot: [-m.lng, -m.lat, 0], zoom: view.current.zoom });
    pinState.current.clear(); // React just re-rendered the pins' classes
    redraw.current = true;
  }, [selected, markers]);

  // Draw loop: redraws the canvas and moves the pins only when the view changed.
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
    const r0 = size / 2 - 6;
    const lens = size / 2 - 2;
    const pinPx = size < 420 ? (h: number) => 16 + h * 8 : (h: number) => 18 + h * 10;
    let raf = 0;
    let last = performance.now();

    const placePins = () => {
      const { markers: ms, selected: sel } = latest.current;
      const center: [number, number] = [-view.current.rot[0], -view.current.rot[1]];
      const pts = ms.map((m) => {
        const dist = geoDistance([m.lng, m.lat], center);
        const p = dist < Math.PI / 2 - 0.04 ? projection([m.lng, m.lat]) : null;
        const inLens = !!p && Math.hypot(p[0] - size / 2, p[1] - size / 2) < lens - 8;
        return { m, x: p?.[0] ?? 0, y: p?.[1] ?? 0, visible: inLens, fade: clamp((Math.PI / 2 - dist) / 0.35, 0, 1) };
      });
      // Greedy clustering: the selected pin and the hottest pins claim their neighbours.
      const order = pts.filter((p) => p.visible).sort((a, b) => Number(b.m.key === sel) - Number(a.m.key === sel) || b.m.heat - a.m.heat);
      const owner = new Map<string, string>();
      const count = new Map<string, number>();
      for (const p of order) {
        if (owner.has(p.m.key)) continue;
        owner.set(p.m.key, p.m.key);
        let n = 1;
        for (const q of order) {
          if (!owner.has(q.m.key) && Math.hypot(p.x - q.x, p.y - q.y) < CLUSTER_PX) {
            owner.set(q.m.key, p.m.key);
            n++;
          }
        }
        count.set(p.m.key, n);
      }
      clusterOf.current = owner;
      for (const p of pts) {
        const el = pinEls.current.get(p.m.key);
        if (!el) continue;
        const show = p.visible && owner.get(p.m.key) === p.m.key;
        const n = show ? (count.get(p.m.key) ?? 1) : 0;
        if (show) {
          el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
          el.style.opacity = p.fade.toFixed(2);
        }
        const px = Math.round(pinPx(p.m.heat));
        const sig = `${show ? 1 : 0}|${n}|${px}`;
        if (pinState.current.get(p.m.key) === sig) continue;
        pinState.current.set(p.m.key, sig);
        el.style.width = el.style.height = `${px}px`;
        if (!show) el.style.opacity = "0";
        el.style.visibility = show ? "visible" : "hidden";
        el.tabIndex = show ? 0 : -1;
        el.setAttribute("aria-hidden", show ? "false" : "true");
        el.classList.toggle("cluster", n > 1);
        el.dataset.count = n > 1 ? String(n) : "";
        el.setAttribute("aria-label", n > 1 ? `${p.m.name} and ${n - 1} more nearby: zoom in` : `${p.m.name}, ${p.m.sub}`);
        const label = el.querySelector(".pin-label");
        if (label) label.textContent = n > 1 ? `${p.m.name} +${n - 1}` : p.m.name;
      }
    };

    const frame = () => {
      const now = performance.now();
      const dt = Math.min(64, now - last);
      last = now;
      const a = anim.current;
      if (a) {
        const e = ease(Math.min(1, (now - a.start) / a.dur));
        view.current = {
          rot: [lerpAngle(a.from.rot[0], a.to.rot[0], e), a.from.rot[1] + (a.to.rot[1] - a.from.rot[1]) * e, 0],
          zoom: a.from.zoom + (a.to.zoom - a.from.zoom) * e,
        };
        redraw.current = true;
        if (e >= 1) anim.current = null;
      } else if (
        !gesture.current &&
        !hovering.current &&
        !focused.current &&
        !pausedRef.current &&
        !reduced.current &&
        onScreen.current &&
        view.current.zoom < 1.05 &&
        now > idleUntil.current
      ) {
        view.current.rot = [view.current.rot[0] + dt * 0.005, view.current.rot[1], 0];
        redraw.current = true;
      }
      if (redraw.current) {
        redraw.current = false;
        const { rot, zoom } = view.current;
        projection.scale(r0 * zoom).translate([size / 2, size / 2]).rotate(rot);
        const col = colors.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, lens, 0, Math.PI * 2);
        ctx.clip();
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
        ctx.restore();
        ctx.beginPath();
        if (zoom > 1.05) ctx.arc(size / 2, size / 2, lens - 0.6, 0, Math.PI * 2);
        else path({ type: "Sphere" });
        ctx.strokeStyle = col.rim;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        placePins();
      }
      raf = requestAnimationFrame(frame);
    };
    redraw.current = true;
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, land, projection]);

  // Markers changed (filter): place the new pins on the next frame.
  useEffect(() => {
    pinState.current.clear();
    redraw.current = true;
  }, [markers]);

  // ----- gestures: one finger turns, two fingers pinch-zoom -----
  const pinchDist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const startDrag = (x: number, y: number) => {
    gesture.current = { kind: "drag", x, y, rot: [...view.current.rot] as Rot, moved: false };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    anim.current = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) gesture.current = { kind: "pinch", dist: pinchDist(), zoom: view.current.zoom };
    else startDrag(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !size) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g?.kind === "pinch") {
      const d = pinchDist();
      if (g.dist > 0 && d > 0) view.current.zoom = clamp((g.zoom * d) / g.dist, 1, MAX_ZOOM);
      redraw.current = true;
    } else if (g?.kind === "drag") {
      const k = 200 / (size * view.current.zoom);
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      view.current.rot = [g.rot[0] + dx * k, clamp(g.rot[1] - dy * k, -80, 80), 0];
      redraw.current = true;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const left = [...pointers.current.values()][0];
    if (left) startDrag(left.x, left.y);
    else gesture.current = null;
    setZoomed(view.current.zoom > 1.05);
    idleUntil.current = performance.now() + 6000;
  };

  const zoomBy = (f: number) => goTo({ rot: view.current.rot, zoom: view.current.zoom * f }, 450);

  function pressPin(key: string) {
    const members = [...clusterOf.current.entries()].filter(([, owner]) => owner === key).map(([k]) => k);
    if (members.length < 2) return onSelect(key);
    // A cluster: zoom in on it until its pins separate.
    const ms = latest.current.markers.filter((m) => members.includes(m.key));
    let minSep = Math.PI;
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) minSep = Math.min(minSep, geoDistance([ms[i]!.lng, ms[i]!.lat], [ms[j]!.lng, ms[j]!.lat]));
    const need = (CLUSTER_PX * 1.6) / ((size / 2 - 6) * Math.max(minSep, 1e-3));
    const lng = ms.reduce((s, m) => s + m.lng, 0) / ms.length;
    const lat = ms.reduce((s, m) => s + m.lat, 0) / ms.length;
    goTo({ rot: [-lng, -lat, 0], zoom: Math.max(view.current.zoom * 1.8, need) });
  }

  return (
    <div
      ref={wrap}
      className={`globe${zoomed ? " zoomed" : ""}`}
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onPointerEnter={(e) => e.pointerType === "mouse" && (hovering.current = true)}
      onPointerLeave={(e) => {
        hovering.current = false;
        if (e.pointerType === "mouse") onPointerUp(e);
      }}
      style={{ height: size || undefined }}
    >
      <canvas ref={canvas} aria-hidden="true" style={{ width: size, height: size }} />
      {markers.map((m) => (
        <button
          key={m.key}
          ref={(el) => {
            if (el) pinEls.current.set(m.key, el);
            else pinEls.current.delete(m.key);
          }}
          type="button"
          className={`pin-dest${m.key === selected ? " on" : ""}`}
          style={{ visibility: "hidden", opacity: 0 }}
          tabIndex={-1}
          aria-pressed={m.key === selected}
          aria-label={`${m.name}, ${m.sub}`}
          onClick={() => pressPin(m.key)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" />
            <rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
          <span className="pin-label">{m.name}</span>
        </button>
      ))}
      <div className="globe-zoom">
        <button type="button" aria-label={paused ? "Start the globe turning" : "Stop the globe turning"} aria-pressed={paused} onClick={() => setPaused((x) => !x)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            {paused ? <path d="M8 5v14l11-7z" fill="currentColor" /> : <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" />}
          </svg>
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.8)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" disabled={!zoomed} onClick={() => (view.current.zoom / 1.8 < 1.3 ? goTo({ rot: view.current.rot, zoom: 1 }, 450) : zoomBy(1 / 1.8))}>
          −
        </button>
      </div>
    </div>
  );
}
