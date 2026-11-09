import Ionicons from "@expo/vector-icons/Ionicons";
import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, View, useColorScheme, type PanResponderGestureState } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Path } from "react-native-svg";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { FONT, useTheme } from "./theme";
import { Text } from "./ui";

export interface GlobeMarker {
  key: string;
  name: string;
  /** Second line for screen readers, e.g. the country. */
  sub: string;
  lat: number;
  lng: number;
  /** 0–1: how hot the destination is right now (a bigger pin). */
  heat: number;
}

type View2 = { rot: [number, number]; zoom: number };

const MAX_ZOOM = 6;
/** Pins closer than this (px) merge into one numbered cluster; tapping it zooms in. */
const CLUSTER_PX = 22;
const HIT = 34;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Longitudes the short way round. */
const lerpAngle = (a: number, b: number, k: number) => a + ((((b - a + 540) % 360) - 180) * k);
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

// Land at 1:110m from world-atlas, turned into shapes once, the first time a globe is drawn.
let landShape: GeoPermissibleObjects | null = null;
function land(): GeoPermissibleObjects {
  if (!landShape) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const world = require("world-atlas/land-110m.json") as Topology<{ land: GeometryCollection }>;
    landShape = feature(world, world.objects.land) as unknown as GeoPermissibleObjects;
  }
  return landShape;
}
const GRATICULE = geoGraticule10();
const SPHERE = { type: "Sphere" } as const;

/**
 * The site's globe for the phone: a pin per destination, in the site's palette. Drag sideways
 * to turn it (up and down scrolls the page, unless zoomed in), tap a pin to choose it, tap a
 * numbered cluster or + to zoom in. It only redraws while it moves; nothing turns on its own.
 * `onActive` is true while a finger is turning it, so the page can stop scrolling meanwhile.
 */
export function Globe({
  markers,
  selected,
  onSelect,
  onActive,
  size,
}: {
  markers: GlobeMarker[];
  selected: string | null;
  onSelect: (key: string) => void;
  onActive?: (active: boolean) => void;
  size: number;
}) {
  const t = useTheme();
  const dark = useColorScheme() === "dark";
  const colors = { ocean: t.accentSoft, land: t.hero, landLine: dark ? "#46553f" : "#b5c8a6", grid: t.surface, rim: t.line };
  const [view, setView] = useState<View2>({ rot: [-18, -24], zoom: 1 }); // over the Mediterranean
  const [moving, setMoving] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const anim = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<View2 | null>(null);
  const start = useRef<View2>(view);
  const activeCb = useRef(onActive);
  activeCb.current = onActive;

  const r0 = size / 2 - 6;
  const projection = useMemo(() => geoOrthographic().clipAngle(90), []);

  function stopAnim() {
    if (anim.current != null) cancelAnimationFrame(anim.current);
    anim.current = null;
  }
  function goTo(to: View2, dur = 700) {
    const target: View2 = { rot: [to.rot[0], clamp(to.rot[1], -70, 70)], zoom: clamp(to.zoom, 1, MAX_ZOOM) };
    stopAnim();
    const from = viewRef.current;
    const t0 = Date.now();
    setMoving(true);
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / dur);
      const e = ease(k);
      setView({
        rot: [lerpAngle(from.rot[0], target.rot[0], e), from.rot[1] + (target.rot[1] - from.rot[1]) * e],
        zoom: from.zoom + (target.zoom - from.zoom) * e,
      });
      if (k < 1) anim.current = requestAnimationFrame(step);
      else {
        anim.current = null;
        setMoving(false);
      }
    };
    anim.current = requestAnimationFrame(step);
  }
  useEffect(() => () => {
    stopAnim();
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  // Swing the chosen destination to the front.
  useEffect(() => {
    const m = markers.find((x) => x.key === selected);
    if (m) goTo({ rot: [-m.lng, -m.lat], zoom: viewRef.current.zoom });
    // Only when the choice changes, not when the filter does.
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useMemo(() => {
    const wants = (g: PanResponderGestureState) =>
      viewRef.current.zoom > 1.05 ? Math.hypot(g.dx, g.dy) > 6 : Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy);
    const end = () => {
      setMoving(false);
      activeCb.current?.(false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => wants(g),
      onMoveShouldSetPanResponderCapture: (_, g) => wants(g),
      onPanResponderGrant: () => {
        stopAnim();
        start.current = viewRef.current;
        setMoving(true);
        activeCb.current?.(true);
      },
      onPanResponderMove: (_, g) => {
        const s = start.current;
        // One radian per globe radius dragged, so the land follows the finger.
        const k = 57.3 / ((size / 2 - 6) * s.zoom);
        pending.current = { rot: [s.rot[0] + g.dx * k, clamp(s.rot[1] - g.dy * k, -70, 70)], zoom: s.zoom };
        if (frame.current == null) {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (pending.current) setView(pending.current);
          });
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, [size]);

  // The drawing: coarser while it moves, so dragging stays smooth.
  const paths = useMemo(() => {
    projection
      .rotate([view.rot[0], view.rot[1], 0])
      .translate([size / 2, size / 2])
      .scale(r0 * view.zoom)
      .precision(moving ? 2 : 0.6);
    const path = geoPath(projection).digits(moving ? 0 : 1);
    return { sphere: path(SPHERE) ?? "", grid: path(GRATICULE) ?? "", land: path(land()) ?? "" };
  }, [projection, view, size, r0, moving]);

  // Pins on the near side, inside the lens; close ones merge into a cluster.
  const pins = useMemo(() => {
    const center: [number, number] = [-view.rot[0], -view.rot[1]];
    const pts = markers
      .map((m) => {
        const dist = geoDistance([m.lng, m.lat], center);
        const p = dist < Math.PI / 2 - 0.04 ? projection([m.lng, m.lat]) : null;
        const inLens = !!p && Math.hypot(p[0] - size / 2, p[1] - size / 2) < r0 - 6;
        return { m, x: p?.[0] ?? 0, y: p?.[1] ?? 0, visible: inLens, fade: clamp((Math.PI / 2 - dist) / 0.35, 0.25, 1) };
      })
      .filter((p) => p.visible)
      .sort((a, b) => Number(b.m.key === selected) - Number(a.m.key === selected) || b.m.heat - a.m.heat);
    const taken = new Set<string>();
    const out: { m: GlobeMarker; x: number; y: number; fade: number; members: GlobeMarker[] }[] = [];
    for (const p of pts) {
      if (taken.has(p.m.key)) continue;
      taken.add(p.m.key);
      const members = [p.m];
      for (const q of pts) {
        if (!taken.has(q.m.key) && Math.hypot(p.x - q.x, p.y - q.y) < CLUSTER_PX) {
          taken.add(q.m.key);
          members.push(q.m);
        }
      }
      out.push({ ...p, members });
    }
    return out;
    // `paths` changes with the projection, so pins follow the same view.
  }, [markers, selected, projection, paths, size, r0]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (f: number) => goTo({ rot: viewRef.current.rot, zoom: viewRef.current.zoom * f }, 450);
  const chosen = pins.find((p) => p.m.key === selected && p.members.length === 1);

  return (
    // Not one accessible element: each pin is its own button for screen readers.
    <View style={{ width: size, height: size, alignSelf: "center" }} {...pan.panHandlers}>
      <Svg width={size} height={size}>
        <Defs>
          <ClipPath id="lens">
            <Circle cx={size / 2} cy={size / 2} r={r0} />
          </ClipPath>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r0} fill={colors.ocean} />
        <G clipPath="url(#lens)">
          <Path d={paths.sphere} fill={colors.ocean} />
          <Path d={paths.grid} fill="none" stroke={colors.grid} strokeOpacity={0.55} strokeWidth={0.6} />
          <Path d={paths.land} fill={colors.land} stroke={colors.landLine} strokeWidth={0.6} />
        </G>
        <Circle cx={size / 2} cy={size / 2} r={r0} fill="none" stroke={colors.rim} strokeWidth={1.5} />
      </Svg>

      {pins.map((p) => {
        const n = p.members.length;
        const on = p.m.key === selected && n === 1;
        const dot = n > 1 ? 22 : on ? 16 : 10 + Math.round(p.m.heat * 5);
        return (
          <Pressable
            key={p.m.key}
            accessibilityRole="button"
            accessibilityLabel={n > 1 ? `${n} places: ${p.members.map((x) => x.name).join(", ")}. Zoom in` : `${p.m.name}, ${p.m.sub}`}
            accessibilityState={{ selected: on }}
            onPress={() => (n > 1 ? goTo({ rot: [-p.m.lng, -p.m.lat], zoom: viewRef.current.zoom * 2.2 }, 600) : onSelect(p.m.key))}
            hitSlop={4}
            style={{ position: "absolute", left: p.x - HIT / 2, top: p.y - HIT / 2, width: HIT, height: HIT, alignItems: "center", justifyContent: "center", opacity: p.fade }}
          >
            <View
              style={{
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                backgroundColor: on ? t.ink : t.accent,
                borderWidth: 2,
                borderColor: t.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {n > 1 ? <Text style={{ color: t.accentInk, fontSize: 11, fontWeight: "700", lineHeight: 13 }}>{n}</Text> : null}
            </View>
          </Pressable>
        );
      })}

      {chosen ? (
        <View pointerEvents="none" style={{ position: "absolute", left: clamp(chosen.x - 80, 4, size - 164), top: Math.max(2, chosen.y - 40), width: 160, alignItems: "center" }}>
          <Text
            numberOfLines={1}
            style={{ color: t.ink, backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 999, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 2, fontFamily: FONT.display, fontSize: 13 }}
          >
            {chosen.m.name}
          </Text>
        </View>
      ) : null}

      <View style={{ position: "absolute", right: 2, bottom: 2, gap: 8 }}>
        {view.zoom > 1.05 ? <ZoomButton icon="remove" label="Zoom out" onPress={() => zoomBy(1 / 2.2)} /> : null}
        <ZoomButton icon="add" label="Zoom in" onPress={() => zoomBy(2.2)} disabled={view.zoom >= MAX_ZOOM - 0.01} />
      </View>
    </View>
  );
}

function ZoomButton({ icon, label, onPress, disabled }: { icon: "add" | "remove"; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
    >
      <Ionicons name={icon} size={18} color={t.ink} />
    </Pressable>
  );
}
