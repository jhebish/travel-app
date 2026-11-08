import {
  AIRBNB_ICONS,
  SOURCE_BY_ID,
  friendPickLabel,
  STAY_STYLES,
  STAY_TIERS,
  airbnbSearchUrl,
  dateSpan,
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
  type Hotel,
  type PlaceVerification,
  type StayPrefs,
  type Stop,
  type StayScale,
  type StayTier,
  type Trip,
  type TripLength,
} from "@travel/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Share, TextInput, View } from "react-native";
import { api } from "./api";
import { PhotoGallery, PlacePhoto, type GalleryTarget } from "./PhotoGallery";
import { FONT, useTheme } from "./theme";
import { Button, Card, ChipRow, Loading, P, Status, styles, Text } from "./ui";

const WEB = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
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
function Rentals({ trip, lead }: { trip: Trip; lead: string }) {
  const t = useTheme();
  const windows = stayWindows(trip);
  const guests = guestsFor(trip.request);
  return (
    <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: t.line }}>
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

/** Shown when a pick matches what they've loved before (from their taste profile). */
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
function HotNow({ p }: { p: Stop }) {
  const t = useTheme();
  const sources = p.hot?.sources ?? [];
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

export function TripView({ trip: initial, onChange }: { trip: Trip; onChange?: (t: Trip) => void }) {
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
  }, [initial.id, initial.destination]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showStay, setShowStay] = useState(false);
  const [gallery, setGallery] = useState<GalleryTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setTrip(initial), [initial]);

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
  async function share() {
    try {
      let token = trip.shareToken;
      if (!token) {
        const { trip: next } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/share`, { method: "POST", json: { enabled: true } });
        apply(next);
        token = next.shareToken;
      }
      if (token) await Share.share({ message: `${it.title}: ${WEB}/t/${token}`, url: `${WEB}/t/${token}` });
    } catch (e) {
      fail(e);
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
        <View style={[styles.row, { marginTop: 4 }]}>
          <Button ghost title={trip.saved ? "Saved" : "Save"} onPress={() => update({ saved: !trip.saved })} />
          <Button ghost title="Share" onPress={share} />
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel="Rate this trip">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Rate ${n} of 5`} onPress={() => update({ rating: trip.rating === n ? 0 : n })} hitSlop={6}>
            <Text style={{ fontSize: 30, color: n <= trip.rating ? t.saffron : t.line }}>★</Text>
          </Pressable>
        ))}
      </View>

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
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.6, lineHeight: 28 }}>{d.theme}</Text>
        <View style={styles.row}>
          <Button ghost title="Open in Google Maps" onPress={() => open(googleMapsDayUrl(d.stops, trip.destination))} />
          <Button ghost title="Rebuild day" disabled={!!busy} onPress={() => setRebuildOpen(!rebuildOpen)} />
        </View>
        {rebuildOpen && (
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
                  <HotNow p={s} />
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
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <IconBtn label={s.locked ? `Unlock ${s.name}` : `Lock ${s.name}`} icon={s.locked ? "lock-closed" : "lock-open-outline"} on={!!s.locked} onPress={() => edit({ action: "lock", day: dIdx, index: si, locked: !s.locked }, `lock-${k}`)} />
                    <IconBtn label={`Swap ${s.name}`} icon="swap-horizontal" disabled={!!busy} onPress={() => setSwapOpen(swapOpen === k ? null : k)} />
                    <IconBtn label={`Good pick: ${s.name}`} icon="thumbs-up-outline" on={v === 1} onColor={t.good} onPress={() => vote(k, 1)} />
                    <IconBtn label={`Not for me: ${s.name}`} icon="thumbs-down-outline" on={v === -1} onColor={t.bad} onPress={() => vote(k, -1)} />
                  </View>
                  {swapOpen === k && (
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
                <View style={[styles.row, { justifyContent: "flex-end" }]}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <IconBtn label={`Good pick: ${h.name}`} icon="thumbs-up-outline" on={trip.votes[`h-${i}`] === 1} onColor={t.good} onPress={() => vote(`h-${i}`, 1)} />
                    <IconBtn label={`Not for me: ${h.name}`} icon="thumbs-down-outline" on={trip.votes[`h-${i}`] === -1} onColor={t.bad} onPress={() => vote(`h-${i}`, -1)} />
                  </View>
                </View>
              </View>
            ))}
            <P muted style={{ fontSize: 14 }}>Prices are typical nightly estimates unless marked live.</P>
            <Rentals trip={trip} lead="Rather rent a whole place?" />
            {showStay ? stayControls : <Button ghost title="Change hotel style or price" onPress={() => setShowStay(true)} />}
          </>
        ) : (
          <>
            {stayControls}
            <Rentals trip={trip} lead="Or rent a whole place" />
          </>
        )}
      </Card>

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
