import {
  SOURCE_BY_ID,
  STAY_PRICES,
  STAY_STYLES,
  googleMapsDayUrl,
  isSourceId,
  legBetween,
  legLabel,
  type Hotel,
  type StayPrefs,
  type Stop,
  type Trip,
} from "@travel/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Share, Text, TextInput, View } from "react-native";
import { api } from "./api";
import { useTheme } from "./theme";
import { Button, Card, ChipRow, Loading, P, Status, styles } from "./ui";

const WEB = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const open = (url?: string) => url && Linking.openURL(url).catch(() => {});
const ratesUrl = (h: Hotel, city: string) => "https://www.google.com/travel/search?q=" + encodeURIComponent(`${h.name} ${h.neighborhood} ${city}`);

function SourceTag({ p }: { p: Stop | Hotel }) {
  const t = useTheme();
  const id = isSourceId(p.source) ? p.source : "reviews";
  return (
    <View style={styles.row}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.sources[id] }} />
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{SOURCE_BY_ID[id].name}</Text>
      {p.origin === "ai" && <Text style={{ color: t.faint, fontSize: 12 }}>AI pick</Text>}
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
    initial.request.stay?.styles?.length ? { ...initial.request.stay, on: true } : { on: true, styles: ["Boutique"], price: "$150–300" },
  );
  const [showStay, setShowStay] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setTrip(initial), [initial]);

  const it = trip.itinerary;
  const dIdx = Math.min(day, it.days.length - 1);
  const d = it.days[dIdx]!;
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
      <ChipRow options={STAY_PRICES} value={[stay.price]} single onChange={([price]) => price && setStay({ ...stay, price })} />
      {busy === "hotels" ? <Loading text="Finding places to stay near where your days happen" /> : <Button ghost title={it.hotels?.length ? "Find new hotels" : "Find hotels"} onPress={findHotels} />}
    </View>
  );

  return (
    <View style={{ gap: 18 }}>
      {/* hero */}
      <View style={{ backgroundColor: t.hero, borderRadius: 26, padding: 24, gap: 12 }}>
        <Text style={{ color: t.heroSoft, fontWeight: "600" }}>
          {trip.destination}, {it.days.length} {it.days.length === 1 ? "day" : "days"}
        </Text>
        <Text style={{ color: t.heroInk, fontSize: 32, fontWeight: "800", letterSpacing: -1, lineHeight: 34 }}>{it.title}</Text>
        <Text style={{ color: t.heroSoft, fontSize: 16, lineHeight: 23 }}>{it.summary}</Text>
        <View style={[styles.row, { marginTop: 4 }]}>
          {[
            { label: trip.saved ? "Saved" : "Save", on: trip.saved, onPress: () => update({ saved: !trip.saved }) },
            { label: "Share", on: false, onPress: share },
          ].map((b) => (
            <Pressable
              key={b.label}
              onPress={b.onPress}
              accessibilityRole="button"
              style={{ backgroundColor: b.on ? "#fff" : "rgba(255,255,255,0.16)", borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 }}
            >
              <Text style={{ color: b.on ? t.hero : t.heroInk, fontWeight: "700" }}>{b.label}</Text>
            </Pressable>
          ))}
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
                  <Text style={{ color: t.muted, fontWeight: "700", fontSize: 14, paddingTop: 6 }}>{s.time}</Text>
                  <Text style={{ color: t.ink, fontWeight: "800", fontSize: 18, letterSpacing: -0.3 }}>
                    {s.name}
                    {!!s.neighborhood && <Text style={{ color: t.muted, fontWeight: "500", fontSize: 14 }}> in {s.neighborhood}</Text>}
                  </Text>
                  <P>{s.why}</P>
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
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Pressable onPress={() => open(ratesUrl(h, trip.destination))}>
                    <Text style={{ color: t.accent, fontWeight: "600", fontSize: 14 }}>Check rates</Text>
                  </Pressable>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <IconBtn label={`Good pick: ${h.name}`} icon="thumbs-up-outline" on={trip.votes[`h-${i}`] === 1} onColor={t.good} onPress={() => vote(`h-${i}`, 1)} />
                    <IconBtn label={`Not for me: ${h.name}`} icon="thumbs-down-outline" on={trip.votes[`h-${i}`] === -1} onColor={t.bad} onPress={() => vote(`h-${i}`, -1)} />
                  </View>
                </View>
              </View>
            ))}
            <P muted style={{ fontSize: 14 }}>Prices are typical nightly estimates unless marked live.</P>
            {showStay ? stayControls : <Button ghost title="Change hotel style or price" onPress={() => setShowStay(true)} />}
          </>
        ) : (
          stayControls
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
    </View>
  );
}
