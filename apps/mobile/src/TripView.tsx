import {
  AIRBNB_ICONS,
  SOURCE_BY_ID,
  friendPickLabel,
  STAY_STYLES,
  STAY_TIERS,
  airbnbSearchUrl,
  dateSpan,
  dayAfterTrip,
  fitText,
  googleMapsDayUrl,
  guestsFor,
  guestsText,
  isSourceId,
  legBetween,
  legLabel,
  lengthFit,
  rangeText,
  stayTier,
  stayWindows,
  tierLabel,
  tripIsOver,
  type Hotel,
  type PersonDTO,
  type PlaceVerification,
  type StayPrefs,
  type Stop,
  type StayScale,
  type StayTier,
  type Together,
  type Trip,
  type TripLength,
} from "@travel/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Share, Switch, TextInput, View } from "react-native";
import { ApiError, api } from "./api";
import { PhotoGallery, PlacePhoto, type GalleryTarget } from "./PhotoGallery";
import { TogetherPanel, WhoIsIn } from "./Together";
import { FONT, useTheme } from "./theme";
import { Button, Card, ChipRow, Loading, P, Status, styles, Text } from "./ui";

const WEB = (process.env.EXPO_PUBLIC_API_URL ?? "https://www.pylos.ai").replace(/\/$/, "");
const open = (url?: string) => url && Linking.openURL(url).catch(() => {});
const ratesUrl = (h: Hotel, city: string) => "https://www.google.com/travel/search?q=" + encodeURIComponent(`${h.name} ${h.neighborhood} ${city}`);

function SourceTag({ p }: { p: Stop | Hotel }) {
  const t = useTheme();
  const id = isSourceId(p.source) ? p.source : "reviews";
  return (
    <View style={styles.row}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.sources[id] }} />
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{p.friend ? `${friendPickLabel(p.friend)}${p.friend.local ? " · Local" : ""}` : SOURCE_BY_ID[id].name}</Text>
      {p.origin === "ai" && <Text style={{ color: t.faint, fontSize: 12 }}>AI pick</Text>}
    </View>
  );
}

/** Airbnb's own icon, loaded from Airbnb; tries the next copy if one fails, and hides if none load. */
function AirbnbIcon() {
  const [n, setN] = useState(0);
  if (n >= AIRBNB_ICONS.length) return null;
  return <Image source={{ uri: AIRBNB_ICONS[n] }} style={{ width: 20, height: 20, borderRadius: 5 }} accessibilityIgnoresInvertColors onError={() => setN((i) => i + 1)} />;
}

/** Airbnb's search for each place on the trip, with its dates and guests, opened outside the app. */
function Rentals({ trip, lead, alone }: { trip: Trip; lead: string; alone?: boolean }) {
  const t = useTheme();
  const windows = stayWindows(trip);
  const guests = guestsFor(trip.request);
  return (
    <View style={{ gap: 8, paddingTop: alone ? 0 : 14, borderTopWidth: alone ? 0 : 1, borderColor: t.line }}>
      <Text style={{ color: t.muted, fontSize: 15 }}>{lead}</Text>
      <View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
        {windows.map((w, i) => {
          const when = w.checkin && w.checkout ? dateSpan(w.checkin, w.checkout) : "Any dates";
          return (
            <Pressable
              key={`${w.place}-${i}`}
              accessibilityRole="link"
              accessibilityLabel={`Search Airbnb in ${w.city}, ${when}, ${guestsText(guests)}`}
              onPress={() => open(airbnbSearchUrl(w, guests))}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingVertical: 7, paddingLeft: 12, paddingRight: 16, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface }}
            >
              <AirbnbIcon />
              <View>
                <Text style={{ color: t.ink, fontWeight: "700", fontSize: 15 }}>{windows.length > 1 ? `Airbnb in ${w.city}` : "Search Airbnb"}</Text>
                <Text style={{ color: t.muted, fontSize: 13.5 }}>
                  {when} · {guestsText(guests)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** How long most people stay, against the days planned. */
function IdealDays({ ideal, days, place }: { ideal: TripLength; days: number; place: string }) {
  const t = useTheme();
  const fit = lengthFit(days, ideal);
  return (
    <View style={{ alignSelf: "flex-start", gap: 2, backgroundColor: fit === "short" ? t.ochre : fit === "long" ? t.lavender : t.hero, borderRadius: 14, paddingVertical: 7, paddingHorizontal: 13 }}>
      <Text style={{ color: t.ink, fontSize: 16.5, lineHeight: 23 }}>
        <Text style={{ fontFamily: FONT.display, fontSize: 11.5, letterSpacing: 1.6, textTransform: "uppercase" }}>Recommended </Text>
        <Text style={{ fontWeight: "700" }}>{rangeText(ideal)}</Text> {fitText(days, ideal, place)}
      </Text>
      {!!ideal.note && <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21 }}>{ideal.note}</Text>}
    </View>
  );
}

/** The place's own website and phone number, when Google Maps lists them. */
function ContactLinks({ place }: { place?: PlaceVerification }) {
  const t = useTheme();
  const site = place?.website;
  const phone = place?.phone;
  const link = { color: t.accent, fontSize: 14, fontWeight: "600" } as const;
  return (
    <>
      {!!site && (
        <Pressable accessibilityRole="link" accessibilityLabel="Website" onPress={() => open(site)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="globe-outline" size={14} color={t.accent} />
          <Text style={link}>Website</Text>
        </Pressable>
      )}
      {!!phone && (
        <Pressable accessibilityRole="link" accessibilityLabel={`Call ${phone}`} onPress={() => open(`tel:${phone.replace(/[^\d+]/g, "")}`)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="call-outline" size={14} color={t.accent} />
          <Text style={link}>{phone}</Text>
        </Pressable>
      )}
    </>
  );
}

type Vis = NonNullable<Trip["visibility"]>;
const VIS: { value: Vis; label: string; hint: string }[] = [
  { value: "private", label: "Only me", hint: "Hidden from the community." },
  { value: "followers", label: "Followers", hint: "People who follow you see it in their feed and on your profile." },
  { value: "public", label: "Everyone", hint: "Shown on your profile and can rank in the top trips for this city." },
];
const VIS_LABELS = Object.fromEntries(VIS.map((v) => [v.value, v.label])) as Record<Vis, string>;
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Sharing, as on the site: the public link on or off, who sees it in the community, and (for a dated trip) whether it shows while you're away. */
function ShareOptions({
  trip,
  busy,
  note,
  onShared,
  onSend,
  onVisibility,
}: {
  trip: Trip;
  busy: string | null;
  note: string | null;
  onShared: (on: boolean) => void;
  onSend: () => void;
  onVisibility: (patch: { visibility?: Vis; shareWhileAway?: boolean }) => void;
}) {
  const t = useTheme();
  const vis = trip.visibility ?? "private";
  const after = dayAfterTrip(trip.request?.startDate, trip.request?.days);
  const away = !!after && !tripIsOver(trip.request) && vis !== "private";
  const row = { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 } as const;
  return (
    <View style={{ backgroundColor: t.sunk, borderRadius: 16, padding: 14, gap: 12 }}>
      <View style={row}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>Public link</Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>{trip.shareToken ? "On: the link works for anyone" : "Off: only you can see this trip"}</Text>
        </View>
        <Switch accessibilityLabel="Public link" value={!!trip.shareToken} disabled={!!busy} onValueChange={onShared} />
      </View>
      {trip.shareToken ? <Button title="Send the link" onPress={onSend} /> : null}
      <Text style={{ color: t.muted, fontSize: 14 }}>Anyone with the link can see the plan. Your ratings and the personal details you entered stay private.</Text>
      <View style={{ gap: 8 }}>
        <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>In the community</Text>
        <ChipRow options={VIS.map((v) => v.value)} labels={VIS_LABELS} value={[vis]} single onChange={([v]) => v && v !== vis && !busy && onVisibility({ visibility: v })} />
        <Text style={{ color: t.muted, fontSize: 14 }}>{VIS.find((v) => v.value === vis)!.hint}</Text>
      </View>
      {away ? (
        <View style={row}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>Share while I&apos;m away</Text>
            <Text style={{ color: t.muted, fontSize: 14 }}>
              {trip.shareWhileAway ? "On: people can see it now, while you're there." : `Off: others see it from ${dayLabel(after!)}, once you're home, so nobody knows you're away.`}
            </Text>
          </View>
          <Switch accessibilityLabel="Share while I'm away" value={!!trip.shareWhileAway} disabled={!!busy} onValueChange={(on) => onVisibility({ shareWhileAway: on })} />
        </View>
      ) : null}
      {note ? <Status text={note} err /> : null}
    </View>
  );
}

/** A trip with several stops: the route, with how to get from one stop to the next, and other towns to swap in. */
function RouteCard({
  route,
  readOnly,
  busy,
  onSwap,
}: {
  route: NonNullable<Trip["itinerary"]["route"]>;
  readOnly?: boolean;
  busy: string | null;
  onSwap: (leg: number, city: string) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Card>
      <Text style={{ color: t.ink, fontSize: 22, fontWeight: "800" }}>The route</Text>
      {route.map((l, i) => (
        <View key={`${l.city}-${i}`} style={{ gap: 6, borderTopWidth: i ? 1 : 0, borderColor: t.line, paddingTop: i ? 14 : 0 }}>
          {i > 0 && l.transfer && (l.transfer.mode || l.transfer.duration) ? (
            <Text style={{ color: t.faint, fontSize: 14 }}>
              {[l.transfer.mode, l.transfer.duration].filter(Boolean).join(" · ")}
              {l.transfer.note ? ` · ${l.transfer.note}` : ""}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
            <Text style={{ color: t.accent, fontWeight: "800", fontSize: 18 }}>{i + 1}</Text>
            <Text style={{ color: t.ink, fontWeight: "800", fontSize: 19, flexShrink: 1 }}>
              {l.city}
              <Text style={{ color: t.muted, fontWeight: "500", fontSize: 15 }}>
                {" "}
                · {l.days} {l.days === 1 ? "day" : "days"}
              </Text>
            </Text>
          </View>
          {!!l.why && <P style={{ fontSize: 16 }}>{l.why}</P>}
          {!!l.season && <Text style={{ color: t.muted, fontSize: 14.5 }}>{l.season}</Text>}
          {!readOnly && !!l.alternatives?.length && (
            <>
              <Pressable onPress={() => setOpen(open === i ? null : i)} hitSlop={6}>
                <Text style={{ color: t.accent, fontWeight: "600", fontSize: 15 }}>{open === i ? "Keep this stop" : "Swap this stop"}</Text>
              </Pressable>
              {open === i &&
                (busy === `city-${i}` ? (
                  <Loading text="Planning the new stop…" />
                ) : (
                  <View style={{ gap: 8 }}>
                    {l.alternatives.map((a) => (
                      <Pressable
                        key={a.city}
                        accessibilityRole="button"
                        disabled={!!busy}
                        onPress={() => onSwap(i, a.city)}
                        style={{ backgroundColor: t.sunk, borderRadius: 14, padding: 12, gap: 2, opacity: busy ? 0.5 : 1 }}
                      >
                        <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>{a.city}</Text>
                        {!!a.why && <Text style={{ color: t.muted, fontSize: 14.5 }}>{a.why}</Text>}
                      </Pressable>
                    ))}
                  </View>
                ))}
            </>
          )}
        </View>
      ))}
    </Card>
  );
}

interface PulseView {
  city: string;
  updated: string;
  /** Earlier lists exist, so "new" means new this month. */
  hasHistory: boolean;
  spots: { name: string; neighborhood: string; type: "bar" | "club"; style: string; when: string; door: string; why: string; hot: Stop["hot"] | null; mapsUrl?: string; since: string }[];
}

/** Going out: the city's bars and clubs of the moment (the night pulse), beyond the one or two in the plan. */
function GoingOut({ city, clubsFirst }: { city: string; clubsFirst: boolean }) {
  const t = useTheme();
  const [pulse, setPulse] = useState<PulseView | null>(null);
  const [tab, setTab] = useState<"bar" | "club">(clubsFirst ? "club" : "bar");
  useEffect(() => {
    let alive = true;
    api<{ pulse: PulseView | null }>(`/api/nightlife?city=${encodeURIComponent(city)}`)
      .then((r) => alive && setPulse(r.pulse))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [city]);
  if (!pulse?.spots.length) return null;
  const bars = pulse.spots.filter((s) => s.type === "bar");
  const clubs = pulse.spots.filter((s) => s.type === "club");
  const list = (tab === "club" && clubs.length) || !bars.length ? clubs : bars;
  const recent = (since: string) => pulse.hasHistory && Date.now() - Date.parse(since) <= 40 * 864e5;
  return (
    <Card>
      <View style={{ gap: 4 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: "800" }}>Going out in {pulse.city}</Text>
        <Text style={{ color: t.muted, fontSize: 14.5 }}>Where people go now, from recent coverage. Updated {monthYear(pulse.updated) || "this month"}.</Text>
      </View>
      {bars.length > 0 && clubs.length > 0 && (
        <ChipRow options={["bar", "club"] as const} labels={{ bar: "Drinks", club: "Dancing" }} value={[list === clubs ? "club" : "bar"]} single onChange={([v]) => v && setTab(v)} />
      )}
      {list.slice(0, 8).map((s, i) => (
        <View key={s.name} style={{ gap: 5, borderTopWidth: i ? 1 : 0, borderColor: t.line, paddingTop: i ? 12 : 0 }}>
          <Text style={{ color: t.ink, fontWeight: "800", fontSize: 17 }}>
            {s.name}
            {!!s.neighborhood && <Text style={{ color: t.muted, fontWeight: "500", fontSize: 14 }}> in {s.neighborhood}</Text>}
            {recent(s.since) ? <Text style={{ color: t.accent, fontSize: 13, fontWeight: "700" }}>  NEW</Text> : null}
          </Text>
          <HotNow hot={s.hot} />
          {!!s.why && <P style={{ fontSize: 16 }}>{s.why}</P>}
          {!!(s.style || s.when || s.door) && <Text style={{ color: t.muted, fontSize: 14 }}>{[s.style, s.when, s.door].filter(Boolean).join(" · ")}</Text>}
          {!!s.mapsUrl && (
            <Pressable onPress={() => open(s.mapsUrl)} hitSlop={6}>
              <Text style={{ color: t.accent, fontSize: 14, fontWeight: "600" }}>Map</Text>
            </Pressable>
          )}
        </View>
      ))}
    </Card>
  );
}

/** What a stop costs, roughly ("EGP 500 a boat for an hour (~$10)", "Free"). */
function Cost({ text }: { text?: string }) {
  const t = useTheme();
  if (!text) return null;
  return (
    <Text style={{ color: t.ink, fontSize: 15.5 }}>
      <Text style={{ color: t.olive, fontFamily: FONT.display, fontSize: 11.5, letterSpacing: 1.4, textTransform: "uppercase" }}>Cost </Text>
      {text}
    </Text>
  );
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (d?: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(d ?? "");
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}` : "";
};

/** A bar or club that recent sources call one of the places to go now, with those sources. */
function HotNow({ hot }: { hot?: Stop["hot"] | null }) {
  const t = useTheme();
  const sources = hot?.sources ?? [];
  if (!sources.length) return null;
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: t.clay, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 12, flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
      <Text style={{ color: t.ink, fontFamily: FONT.display, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>Hot right now</Text>
      {sources.map((s, i) => (
        <Text
          key={`${s.name}-${i}`}
          style={{ color: t.ink, fontSize: 14.5, textDecorationLine: s.url ? "underline" : "none" }}
          onPress={s.url ? () => open(s.url) : undefined}
          accessibilityRole={s.url ? "link" : undefined}
        >
          {s.name}
          {s.date ? <Text style={{ color: t.muted }}> {monthYear(s.date)}</Text> : null}
        </Text>
      ))}
    </View>
  );
}

/** Shown when a pick matches what they've loved before (from their taste profile). */
function ForYou({ text }: { text?: string }) {
  const t = useTheme();
  if (!text) return null;
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: t.ochre, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 }}>
      <Text style={{ color: t.ink, fontSize: 15.5 }}>
        <Text style={{ fontFamily: FONT.display, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>For you </Text> {text}
      </Text>
    </View>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>["name"];
function IconBtn({ label, icon, on, onColor, onPress, disabled }: { label: string; icon: IconName; on?: boolean; onColor?: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  const bg = on ? (onColor ?? t.ink) : t.surface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: on ? bg : t.line, backgroundColor: bg, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <Ionicons name={icon} size={17} color={on ? t.surface : t.muted} />
    </Pressable>
  );
}

/**
 * A trip, as on the site. `readOnly` is a plan that isn't yours (a destination's itinerary on
 * Browse, a traveler's trip): no saving, rating, swapping, rebuilding or hotel search.
 */
export function TripView({ trip: initial, onChange, readOnly }: { trip: Trip; onChange?: (t: Trip) => void; readOnly?: boolean }) {
  const t = useTheme();
  const [trip, setTrip] = useState(initial);
  const [day, setDay] = useState(0);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [swapOpen, setSwapOpen] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [dayHint, setDayHint] = useState("");
  const [stay, setStay] = useState<StayPrefs>(
    initial.request.stay?.styles?.length
      ? { ...initial.request.stay, on: true, price: stayTier(initial.request.stay.price) }
      : { on: true, styles: ["Boutique"], price: "$$" },
  );
  // What hotels cost there, for the $ to $$$$ choices (cached per destination). An older trip's
  // price in dollars becomes the tier it buys there.
  const [scale, setScale] = useState<StayScale | null>(null);
  useEffect(() => {
    if (readOnly) return;
    let gone = false;
    api<{ scale: StayScale | null }>(`/api/stay-scale?destination=${encodeURIComponent(initial.destination)}`)
      .then((r) => {
        if (gone || !r.scale) return;
        setScale(r.scale);
        const asked = initial.request.stay?.price;
        if (asked && !STAY_TIERS.includes(asked as StayTier)) setStay((s) => ({ ...s, price: stayTier(asked, r.scale) }));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [initial.id, initial.destination, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showStay, setShowStay] = useState(false);
  const [gallery, setGallery] = useState<GalleryTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setTrip(initial), [initial]);
  const router = useRouter();

  // Planning together: who's on this trip and who's in for each stop (as on the site).
  const isMember = trip.role === "member";
  const [tog, setTog] = useState<Together | null>(null);
  const [togFriends, setTogFriends] = useState<PersonDTO[]>([]);
  const [togOpen, setTogOpen] = useState(false);
  useEffect(() => {
    if (readOnly || !initial.id) return;
    let gone = false;
    api<{ together: Together; friends: PersonDTO[] }>(`/api/trips/${initial.id}/together`)
      .then((r) => {
        if (gone) return;
        setTog(r.together);
        setTogFriends(r.friends ?? []);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [initial.id, readOnly]);
  const togetherOn = (tog?.people.length ?? 0) > 1;
  const me = tog?.people.find((p) => p.me);

  const it = trip.itinerary;
  const dIdx = Math.min(day, it.days.length - 1);
  const d = it.days[dIdx]!;
  // How long most people stay. New trips carry it; older ones ask once (cached per destination).
  const [ideal, setIdeal] = useState<TripLength | null>(it.idealDays ?? null);
  const tripMode = it.mode ?? trip.request.mode ?? "single";
  useEffect(() => {
    if (it.idealDays) {
      setIdeal(it.idealDays);
      return;
    }
    setIdeal(null);
    let gone = false;
    api<{ idealDays: TripLength | null }>(`/api/trip-length?destination=${encodeURIComponent(trip.destination)}&mode=${tripMode}`)
      .then((r) => {
        if (!gone) setIdeal(r.idealDays);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [trip.id, trip.destination, it.idealDays, tripMode]);
  const input = { backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: t.ink, flex: 1 };

  const apply = (next: Trip) => {
    setTrip(next);
    onChange?.(next);
  };
  const fail = (e: unknown) => setMsg({ text: (e as Error).message, err: true });

  function update(patch: Partial<Pick<Trip, "saved" | "rating" | "votes">>) {
    const next = { ...trip, ...patch };
    apply(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api(`/api/trips/${trip.id}`, { method: "PATCH", json: { saved: next.saved, rating: next.rating, votes: next.votes } })
        .then(() => setMsg(null))
        .catch(fail);
    }, 500);
  }
  const vote = (k: string, v: 1 | -1) => {
    const votes = { ...trip.votes };
    const turningDown = v === -1 && votes[k] !== -1;
    if (votes[k] === v) delete votes[k];
    else votes[k] = v;
    update({ votes });
    if (turningDown && !k.startsWith("h-")) {
      setSwapOpen(k);
      setHint("");
    }
  };
  const myReaction = (k: string): 1 | -1 | 0 => (me ? (tog?.reactions[k]?.[me.userId] ?? 0) : 0);
  async function react(k: string, v: 1 | -1) {
    if (!tog || !me) return;
    const value = myReaction(k) === v ? 0 : v;
    const next: Together = { ...tog, reactions: { ...tog.reactions, [k]: { ...(tog.reactions[k] ?? {}) } } };
    if (value) next.reactions[k]![me.userId] = value;
    else delete next.reactions[k]![me.userId];
    setTog(next);
    if (value === -1 && !k.startsWith("h-")) {
      setSwapOpen(k);
      setHint("");
    }
    try {
      const r = await api<{ together: Together }>(`/api/trips/${trip.id}/together/react`, { method: "POST", json: { item: k, value } });
      setTog(r.together);
    } catch (e) {
      fail(e);
    }
  }
  /** Thumbs: your own feedback, and on a shared trip also what you tell your friends. */
  const thumb = (k: string, v: 1 | -1) => {
    if (togetherOn) void react(k, v);
    if (!isMember) vote(k, v);
  };
  const pressed = (k: string, v: 1 | -1) => (togetherOn && isMember ? myReaction(k) === v : trip.votes[k] === v);

  async function edit(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setMsg(null);
    try {
      const { trip: next } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/edit`, { method: "POST", json: body });
      apply(next);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  }
  const [shareOpen, setShareOpen] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  /** Turn the public link on or off. */
  async function setShared(enabled: boolean) {
    setBusy("share");
    setShareNote(null);
    try {
      const { trip: next } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/share`, { method: "POST", json: { enabled } });
      apply(next);
    } catch (e) {
      setShareNote((e as Error).message || "Couldn't change the link. Try again.");
    } finally {
      setBusy(null);
    }
  }
  async function sendLink() {
    const token = trip.shareToken;
    if (token) await Share.share({ message: `${it.title}: ${WEB}/t/${token}`, url: `${WEB}/t/${token}` }).catch(() => {});
  }
  /** Who sees it in the community, and whether a dated trip shows before it's over. */
  async function setVisibility(patch: { visibility?: Vis; shareWhileAway?: boolean }) {
    setBusy("visibility");
    setShareNote(null);
    try {
      await api(`/api/trips/${trip.id}/visibility`, { method: "PUT", json: patch });
      apply({ ...trip, ...patch });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setShareNote(
        `${(e as Error).message}${code === "needs_email" ? " Sign in on the You tab first." : code === "needs_profile" ? " Create your community profile on pylos.ai first." : ""}`,
      );
    } finally {
      setBusy(null);
    }
  }
  async function findHotels() {
    setBusy("hotels");
    setMsg(null);
    try {
      const { trip: next } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/hotels`, { method: "POST", json: { stay } });
      apply(next);
      setShowStay(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const stayControls = (
    <View style={{ gap: 12 }}>
      <ChipRow options={STAY_STYLES} value={stay.styles} onChange={(s) => setStay({ ...stay, styles: s })} />
      <ChipRow
        options={STAY_TIERS}
        labels={Object.fromEntries(STAY_TIERS.map((x) => [x, tierLabel(x, scale)]))}
        value={[stayTier(stay.price)]}
        single
        onChange={([price]) => price && setStay({ ...stay, price })}
      />
      <Text style={{ color: t.muted, fontSize: 13 }}>{scale ? `What a night for two costs in ${trip.destination}.` : "Judged by local prices."}</Text>
      {busy === "hotels" ? <Loading text="Finding places to stay near where your days happen" /> : <Button ghost title={it.hotels?.length ? "Find new hotels" : "Find hotels"} onPress={findHotels} />}
    </View>
  );

  return (
    <View style={{ gap: 18 }}>
      {/* header: plain, as on the site */}
      <View style={{ gap: 10, paddingTop: 4 }}>
        <Text style={{ color: t.muted, fontFamily: FONT.display, fontSize: 12.5, letterSpacing: 2, textTransform: "uppercase" }}>
          {trip.destination} · {it.days.length} {it.days.length === 1 ? "day" : "days"}
        </Text>
        <Text style={{ color: t.ink, fontSize: 32, fontWeight: "800", lineHeight: 38 }}>{it.title}</Text>
        {ideal && <IdealDays ideal={ideal} days={it.days.length} place={trip.destination} />}
        {/* Only when their own trips and ratings give a reason; never a general description. */}
        {it.forYou ? (
          <View style={{ alignSelf: "flex-start", backgroundColor: t.ochre, borderRadius: 14, paddingVertical: 7, paddingHorizontal: 13 }}>
            <Text style={{ color: t.ink, fontSize: 16.5, lineHeight: 23 }}>
              <Text style={{ fontFamily: FONT.display, fontSize: 11.5, letterSpacing: 1.6, textTransform: "uppercase" }}>For you </Text> {it.forYou}
            </Text>
          </View>
        ) : null}
        {!readOnly && (
          <View style={[styles.row, { marginTop: 4 }]}>
            {!isMember && <Button ghost title={trip.saved ? "Saved" : "Save"} onPress={() => update({ saved: !trip.saved })} />}
            {/* Each opens its options below, and closes them again. */}
            {!isMember && <Button ghost title="Share" onPress={() => setShareOpen(!shareOpen)} />}
            <Button ghost title={togetherOn ? `Planning with ${tog!.people.length - 1}` : "Plan together"} onPress={() => setTogOpen(!togOpen)} />
          </View>
        )}
        {!readOnly && togOpen && (
          <TogetherPanel
            tripId={trip.id}
            isOwner={!isMember}
            together={tog}
            friends={togFriends}
            onChange={setTog}
            onLeft={() => (router.canGoBack() ? router.back() : router.replace("/trips"))}
          />
        )}
        {!readOnly && shareOpen && (
          <ShareOptions trip={trip} busy={busy} note={shareNote} onShared={setShared} onSend={sendLink} onVisibility={setVisibility} />
        )}
      </View>

      {it.mode === "multi" && !!it.route?.length && (
        <RouteCard
          route={it.route}
          readOnly={readOnly}
          busy={busy}
          onSwap={(leg, city) => edit({ action: "swap_city", leg, city }, `city-${leg}`)}
        />
      )}

      {!readOnly && !isMember && (
        <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel="Rate this trip">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Rate ${n} of 5`} onPress={() => update({ rating: trip.rating === n ? 0 : n })} hitSlop={6}>
              <Text style={{ fontSize: 30, color: n <= trip.rating ? t.saffron : t.line }}>★</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* day tabs */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, backgroundColor: t.sunk, borderRadius: 999, padding: 4, alignSelf: "flex-start" }}>
        {it.days.map((x, i) => (
          <Pressable
            key={i}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === dIdx }}
            onPress={() => {
              setDay(i);
              setSwapOpen(null);
              setRebuildOpen(false);
            }}
            style={{ backgroundColor: i === dIdx ? t.surface : "transparent", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 }}
          >
            <Text style={{ color: i === dIdx ? t.ink : t.muted, fontWeight: "700" }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>

      <Card>
        {it.mode === "multi" && !!d.city && (
          <Text style={{ color: t.muted, fontFamily: FONT.display, fontSize: 12.5, letterSpacing: 2, textTransform: "uppercase" }}>{d.city}</Text>
        )}
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.6, lineHeight: 28 }}>{d.theme}</Text>
        {!!d.arrival && <Text style={{ color: t.muted, fontSize: 15.5, fontStyle: "italic" }}>{d.arrival}</Text>}
        <View style={styles.row}>
          <Button ghost title="Open in Google Maps" onPress={() => open(googleMapsDayUrl(d.stops, trip.destination))} />
          {!readOnly && <Button ghost title="Rebuild day" disabled={!!busy} onPress={() => setRebuildOpen(!rebuildOpen)} />}
        </View>
        {!readOnly && rebuildOpen && (
          <View style={{ backgroundColor: t.sunk, borderRadius: 16, padding: 14, gap: 10 }}>
            <P muted style={{ fontSize: 14 }}>
              {d.stops.some((s) => s.locked) ? "Locked stops stay put. Everything else gets replaced." : "Tip: lock the stops you love first. They'll stay put."}
            </P>
            {busy === "day" ? (
              <Loading text={`Rebuilding ${d.label.toLowerCase()}`} />
            ) : (
              <View style={styles.row}>
                <TextInput style={input} value={dayHint} onChangeText={setDayHint} placeholder="Optional: slower morning, rainy day" placeholderTextColor={t.faint} maxLength={200} />
                <Button
                  ghost
                  title="Rebuild"
                  onPress={async () => {
                    if (await edit({ action: "regenerate_day", day: dIdx, hint: dayHint }, "day")) {
                      setRebuildOpen(false);
                      setDayHint("");
                    }
                  }}
                />
              </View>
            )}
          </View>
        )}

        <View>
          {d.stops.map((s, si) => {
            const k = `${dIdx}-${si}`;
            const v = trip.votes[k] ?? 0;
            const leg = d.stops[si + 1] ? legBetween(s, d.stops[si + 1]!) : null;
            return (
              <View key={s.name + si} style={{ flexDirection: "row", gap: 14 }}>
                <View style={{ alignItems: "center" }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: s.locked ? t.ink : t.accentSoft }}>
                    <Text style={{ color: s.locked ? t.bg : t.accent, fontWeight: "800" }}>{si + 1}</Text>
                  </View>
                  {si < d.stops.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: t.line, marginVertical: 4 }} />}
                </View>
                <View style={{ flex: 1, gap: 6, paddingBottom: 6 }}>
                  <PlacePhoto
                    photo={s.place?.photos?.[0]}
                    alt={s.name}
                    count={s.place?.photos?.length}
                    onOpen={() => setGallery({ title: s.name, place: s.place })}
                    style={{ width: "100%", aspectRatio: 16 / 10, marginBottom: 4 }}
                  />
                  <Text style={{ color: t.muted, fontWeight: "700", fontSize: 14, paddingTop: 6 }}>{s.time}</Text>
                  <Text style={{ color: t.ink, fontWeight: "800", fontSize: 18, letterSpacing: -0.3 }}>
                    {s.name}
                    {!!s.neighborhood && <Text style={{ color: t.muted, fontWeight: "500", fontSize: 14 }}> in {s.neighborhood}</Text>}
                  </Text>
                  <HotNow hot={s.hot} />
                  <P>{s.why}</P>
                  <Cost text={s.cost} />
                  <ForYou text={s.forYou} />
                  {!!s.localTip && (
                    <P muted style={{ fontSize: 15 }}>
                      <Text style={{ color: t.saffron, fontWeight: "700" }}>Local tip </Text>
                      {s.localTip}
                    </P>
                  )}
                  <View style={styles.row}>
                    <SourceTag p={s} />
                    {s.place?.mapsUrl && (
                      <Pressable onPress={() => open(s.place?.mapsUrl)}>
                        <Text style={{ color: t.accent, fontSize: 14, fontWeight: "600" }}>Map</Text>
                      </Pressable>
                    )}
                    <ContactLinks place={s.place} />
                  </View>
                  {!readOnly && <View style={{ flexDirection: "row", gap: 6 }}>
                    <IconBtn label={s.locked ? `Unlock ${s.name}` : `Lock ${s.name}`} icon={s.locked ? "lock-closed" : "lock-open-outline"} on={!!s.locked} onPress={() => edit({ action: "lock", day: dIdx, index: si, locked: !s.locked }, `lock-${k}`)} />
                    <IconBtn label={`Swap ${s.name}`} icon="swap-horizontal" disabled={!!busy} onPress={() => setSwapOpen(swapOpen === k ? null : k)} />
                    <IconBtn label={togetherOn ? `I'm in: ${s.name}` : `Good pick: ${s.name}`} icon="thumbs-up-outline" on={pressed(k, 1)} onColor={t.good} onPress={() => thumb(k, 1)} />
                    <IconBtn label={togetherOn ? `Pass: ${s.name}` : `Not for me: ${s.name}`} icon="thumbs-down-outline" on={pressed(k, -1)} onColor={t.bad} onPress={() => thumb(k, -1)} />
                  </View>}
                  {togetherOn && <WhoIsIn people={tog!.people} by={tog!.reactions[k]} />}
                  {!readOnly && swapOpen === k && (
                    <View style={{ backgroundColor: t.sunk, borderRadius: 16, padding: 14, gap: 10 }}>
                      {busy === `swap-${k}` ? (
                        <Loading text="Finding another option for this slot" />
                      ) : (
                        <>
                          <Text style={{ color: t.ink, fontWeight: "700" }}>{v === -1 ? "Not quite right? Swap it." : "Swap this stop"}</Text>
                          <View style={styles.row}>
                            <TextInput style={input} value={hint} onChangeText={setHint} placeholder="Optional: cheaper, no seafood" placeholderTextColor={t.faint} maxLength={200} />
                            <Button
                              ghost
                              title="Swap"
                              onPress={async () => {
                                if (await edit({ action: "swap", day: dIdx, index: si, hint }, `swap-${k}`)) {
                                  setSwapOpen(null);
                                  setHint("");
                                }
                              }}
                            />
                          </View>
                        </>
                      )}
                    </View>
                  )}
                  {leg && <Text style={{ color: t.faint, fontSize: 13, paddingVertical: 8 }}>{legLabel(leg)}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      {/* stays */}
      <Card>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.6 }}>Where to stay</Text>
        {it.hotels?.length ? (
          <>
            {it.hotels.map((h, i) => (
              <View key={h.name + i} style={{ gap: 6, paddingTop: i ? 16 : 0, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
                {!!h.place?.photos?.length && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: 4 }}>
                    {h.place.photos.slice(0, 3).map((ph, n) => (
                      <PlacePhoto
                        key={ph.name}
                        photo={ph}
                        alt={h.name}
                        count={n === 0 ? h.place?.photos?.length : undefined}
                        onOpen={() => setGallery({ title: h.name, place: h.place, start: n })}
                        style={{ width: 250, aspectRatio: 3 / 2 }}
                      />
                    ))}
                  </ScrollView>
                )}
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                  <Text style={{ color: t.ink, fontWeight: "800", fontSize: 18, flexShrink: 1 }}>
                    {h.name}
                    <Text style={{ color: t.muted, fontWeight: "500", fontSize: 14 }}> in {h.neighborhood}</Text>
                  </Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: t.ink, fontWeight: "700" }}>{h.liveRate ? `$${h.liveRate.nightlyUsd} a night` : h.nightly}</Text>
                    {h.liveRate && <Text style={{ color: t.good, fontSize: 12, fontWeight: "600" }}>Live rate</Text>}
                  </View>
                </View>
                <View style={styles.row}>
                  {!!h.style && <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600", backgroundColor: t.sunk, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, overflow: "hidden" }}>{h.style}</Text>}
                  <SourceTag p={h} />
                </View>
                <P>{h.why}</P>
                <ForYou text={h.forYou} />
                <View style={styles.row}>
                  <Pressable onPress={() => open(ratesUrl(h, trip.destination))}>
                    <Text style={{ color: t.accent, fontWeight: "600", fontSize: 14 }}>Check rates</Text>
                  </Pressable>
                  {h.place?.mapsUrl && (
                    <Pressable onPress={() => open(h.place?.mapsUrl)}>
                      <Text style={{ color: t.accent, fontSize: 14, fontWeight: "600" }}>Map</Text>
                    </Pressable>
                  )}
                  <ContactLinks place={h.place} />
                </View>
                {!readOnly && <View style={[styles.row, { justifyContent: "flex-end" }]}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <IconBtn label={togetherOn ? `I'm in: ${h.name}` : `Good pick: ${h.name}`} icon="thumbs-up-outline" on={pressed(`h-${i}`, 1)} onColor={t.good} onPress={() => thumb(`h-${i}`, 1)} />
                    <IconBtn label={togetherOn ? `Pass: ${h.name}` : `Not for me: ${h.name}`} icon="thumbs-down-outline" on={pressed(`h-${i}`, -1)} onColor={t.bad} onPress={() => thumb(`h-${i}`, -1)} />
                  </View>
                </View>}
                {!readOnly && togetherOn && <WhoIsIn people={tog!.people} by={tog!.reactions[`h-${i}`]} />}
              </View>
            ))}
            <P muted style={{ fontSize: 14 }}>Prices are typical nightly estimates unless marked live.</P>
            <Rentals trip={trip} lead="Rather rent a whole place?" />
            {readOnly ? null : showStay ? stayControls : <Button ghost title="Change hotel style or price" onPress={() => setShowStay(true)} />}
          </>
        ) : readOnly ? (
          <Rentals trip={trip} lead="Find a place on Airbnb" alone />
        ) : (
          <>
            {stayControls}
            <Rentals trip={trip} lead="Or rent a whole place" />
          </>
        )}
      </Card>

      {/* Trips that asked for nightlife: the city's bars and clubs of the moment. */}
      {!readOnly && it.mode !== "multi" && (trip.request.interests?.includes("Nightlife") || trip.request.clubs) && (
        <GoingOut city={trip.request.destination || trip.destination} clubsFirst={!!trip.request.clubs} />
      )}

      {!!it.notes?.length && (
        <Card>
          <Text style={{ color: t.ink, fontSize: 18, fontWeight: "800" }}>Good to know</Text>
          {it.notes.map((n) => (
            <P key={n} muted style={{ fontSize: 15 }}>
              • {n}
            </P>
          ))}
        </Card>
      )}
      <Status text={msg?.text ?? "Check opening hours before you go."} err={msg?.err} />
      <PhotoGallery target={gallery} onClose={() => setGallery(null)} />
    </View>
  );
}
