import { SOURCE_BY_ID, STAY_PRICES, STAY_STYLES, isSourceId, type Hotel, type StayPrefs, type Stop, type Trip } from "@travel/core";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { api } from "./api";
import { useTheme } from "./theme";
import { Button, Card, ChipRow, H2, Label, Loading, P, Status, styles } from "./ui";

function SourceTag({ p }: { p: Stop | Hotel }) {
  const t = useTheme();
  const id = isSourceId(p.source) ? p.source : "reviews";
  return (
    <View style={styles.row}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.sources[id] }} />
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: "600" }}>{SOURCE_BY_ID[id].name}</Text>
      {p.origin === "ai" && <Text style={{ color: t.muted, fontSize: 11 }}>· AI pick</Text>}
    </View>
  );
}

function Thumbs({ k, votes, onVote }: { k: string; votes: Trip["votes"]; onVote: (k: string, v: 1 | -1) => void }) {
  const t = useTheme();
  const v = votes[k] ?? 0;
  const btn = (val: 1 | -1, label: string, glyph: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: v === val }}
      onPress={() => onVote(k, val)}
      style={{
        width: 40,
        height: 34,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        borderColor: v === val ? (val > 0 ? t.good : t.bad) : t.line,
        backgroundColor: v === val ? (val > 0 ? t.good : t.bad) : t.surface,
      }}
    >
      <Text style={{ color: v === val ? t.surface : t.muted, fontSize: 15, fontWeight: "700" }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {btn(1, "Good pick", "▲")}
      {btn(-1, "Not for me", "▼")}
    </View>
  );
}

const open = (url?: string) => url && Linking.openURL(url).catch(() => {});
const ratesUrl = (h: Hotel, city: string) => "https://www.google.com/travel/search?q=" + encodeURIComponent(`${h.name} ${h.neighborhood} ${city}`);

export function TripView({ trip: initial, onChange }: { trip: Trip; onChange?: (t: Trip) => void }) {
  const t = useTheme();
  const [trip, setTrip] = useState(initial);
  const [day, setDay] = useState(0);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [stay, setStay] = useState<StayPrefs>(
    initial.request.stay?.styles?.length ? { ...initial.request.stay, on: true } : { on: true, styles: ["Boutique"], price: "$150–300" },
  );
  const [busy, setBusy] = useState(false);
  const [showStay, setShowStay] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setTrip(initial), [initial]);

  const it = trip.itinerary;
  const d = it.days[Math.min(day, it.days.length - 1)]!;

  function update(patch: Partial<Pick<Trip, "saved" | "rating" | "votes">>) {
    const next = { ...trip, ...patch };
    setTrip(next);
    onChange?.(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api(`/api/trips/${trip.id}`, { method: "PATCH", json: { saved: next.saved, rating: next.rating, votes: next.votes } })
        .then(() => setMsg(null))
        .catch((e) => setMsg({ text: (e as Error).message, err: true }));
    }, 500);
  }
  const vote = (k: string, v: 1 | -1) => {
    const votes = { ...trip.votes };
    if (votes[k] === v) delete votes[k];
    else votes[k] = v;
    update({ votes });
  };
  async function findHotels() {
    setBusy(true);
    setMsg(null);
    try {
      const { trip: next } = await api<{ trip: Trip }>(`/api/trips/${trip.id}/hotels`, { method: "POST", json: { stay } });
      setTrip(next);
      onChange?.(next);
      setShowStay(false);
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setBusy(false);
    }
  }

  const stayControls = (
    <View style={{ gap: 12 }}>
      <ChipRow options={STAY_STYLES} value={stay.styles} onChange={(styles) => setStay({ ...stay, styles })} />
      <ChipRow options={STAY_PRICES} value={[stay.price]} single onChange={([price]) => price && setStay({ ...stay, price })} />
      {busy ? <Loading text="Finding places to stay near where your days happen…" /> : <Button ghost title={it.hotels?.length ? "Find new hotels" : "Find hotels"} onPress={findHotels} />}
    </View>
  );

  return (
    <Card>
      <View style={{ gap: 6 }}>
        <H2>{it.title}</H2>
        <P muted style={{ fontSize: 13 }}>
          {[trip.request.party, trip.request.age, trip.request.budget.toLowerCase()].filter(Boolean).join(" · ")} · {trip.customMix ? "your source mix" : "app default sources"}
        </P>
        <P muted>{it.summary}</P>
      </View>

      <View style={{ backgroundColor: t.bg, borderRadius: 12, padding: 12, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel="Rate this trip">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Rate ${n} of 5`} onPress={() => update({ rating: trip.rating === n ? 0 : n })} hitSlop={6}>
              <Text style={{ fontSize: 28, color: n <= trip.rating ? t.saffron : t.line }}>★</Text>
            </Pressable>
          ))}
        </View>
        <Button ghost title={trip.saved ? "Saved" : "Save trip"} onPress={() => update({ saved: !trip.saved })} />
      </View>

      <View style={{ gap: 10 }}>
        <Label>Where to stay{it.stayLabel ? ` · ${it.stayLabel}` : ""}</Label>
        {it.hotels?.length ? (
          <>
            {it.hotels.map((h, i) => (
              <View key={h.name + i} style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, gap: 6, backgroundColor: t.bg }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                  <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16, flexShrink: 1 }}>
                    {h.name} <Text style={{ color: t.muted, fontWeight: "500", fontSize: 13 }}>· {h.neighborhood}</Text>
                  </Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: t.ink, fontFamily: "Menlo", fontSize: 13 }}>{h.liveRate ? `$${h.liveRate.nightlyUsd}/night` : h.nightly}</Text>
                    {h.liveRate && <Text style={{ color: t.good, fontSize: 11, fontWeight: "600" }}>Live rate</Text>}
                  </View>
                </View>
                <View style={styles.row}>
                  {!!h.style && <Text style={{ color: t.saffron, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>{h.style}</Text>}
                  <SourceTag p={h} />
                </View>
                <P>{h.why}</P>
                {!!h.localTip && <P muted style={{ fontSize: 13.5 }}><Text style={{ color: t.saffron, fontWeight: "700" }}>Local tip </Text>{h.localTip}</P>}
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Pressable onPress={() => open(ratesUrl(h, trip.destination))}>
                    <Text style={{ color: t.accent, fontWeight: "600", fontSize: 13 }}>Check rates ↗</Text>
                  </Pressable>
                  <Thumbs k={`h-${i}`} votes={trip.votes} onVote={vote} />
                </View>
              </View>
            ))}
            <P muted style={{ fontSize: 13 }}>Prices are typical nightly estimates unless marked live.</P>
            {showStay ? stayControls : <Button ghost title="Change hotel style or price" onPress={() => setShowStay(true)} />}
          </>
        ) : (
          stayControls
        )}
      </View>

      <View style={styles.wrap}>
        {it.days.map((x, i) => (
          <Pressable
            key={i}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === day }}
            onPress={() => setDay(i)}
            style={{ borderWidth: 1, borderColor: i === day ? t.ink : t.line, backgroundColor: i === day ? t.ink : t.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 }}
          >
            <Text style={{ color: i === day ? t.bg : t.ink, fontWeight: "600", fontSize: 13 }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: t.ink, fontFamily: "Georgia", fontSize: 18 }}>{d.theme}</Text>
      <View>
        {d.stops.map((s, si) => (
          <View key={s.name + si} style={{ flexDirection: "row", gap: 12, paddingVertical: 14, borderTopWidth: si ? 1 : 0, borderColor: t.line }}>
            <Text style={{ width: 50, color: t.muted, fontFamily: "Menlo", fontSize: 12.5, paddingTop: 3 }}>{s.time}</Text>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>
                {s.name} <Text style={{ color: t.muted, fontWeight: "500", fontSize: 13 }}>· {s.neighborhood}</Text>
              </Text>
              <P>{s.why}</P>
              {!!s.localTip && <P muted style={{ fontSize: 13.5 }}><Text style={{ color: t.saffron, fontWeight: "700" }}>Local tip </Text>{s.localTip}</P>}
              <View style={[styles.row, { justifyContent: "space-between" }]}>
                <View style={styles.row}>
                  <SourceTag p={s} />
                  {s.place?.mapsUrl && (
                    <Pressable onPress={() => open(s.place?.mapsUrl)}>
                      <Text style={{ color: t.accent, fontSize: 12.5, fontWeight: "600" }}>Map ↗</Text>
                    </Pressable>
                  )}
                </View>
                <Thumbs k={`${day}-${si}`} votes={trip.votes} onVote={vote} />
              </View>
            </View>
          </View>
        ))}
      </View>
      {!!it.notes?.length && (
        <View style={{ gap: 6 }}>
          <Label>Good to know</Label>
          {it.notes.map((n) => (
            <P key={n} muted style={{ fontSize: 13.5 }}>• {n}</P>
          ))}
        </View>
      )}
      <Status text={msg?.text ?? "Check opening hours before you go."} err={msg?.err} />
    </Card>
  );
}
