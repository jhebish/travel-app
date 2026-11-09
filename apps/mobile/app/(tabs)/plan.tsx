import {
  ABOUT_OPTIONS,
  AGE_BANDS,
  BUDGETS,
  INTERESTS,
  MAX_DAYS,
  PACES,
  PARTIES,
  STAY_STYLES,
  STAY_TIERS,
  soonMonth,
  stayTier,
  tierLabel,
  travelMonth,
  type StayScale,
  type Trip,
  type TripRequest,
} from "@travel/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { api } from "../../src/api";
import { useTheme } from "../../src/theme";
import { TripView } from "../../src/TripView";
import { BuildBar, Button, Card, Chip, ChipRow, H1, Label, Loading, P, Screen, Status, styles, Text } from "../../src/ui";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The next twelve months, starting with this one, for "When", as on the site. */
function upcomingMonths() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { value: d.getMonth() + 1, label: `${MONTH_NAMES[d.getMonth()]!.slice(0, 3)}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}` };
  });
}

const ABOUT_LABELS = {
  "LGBTQ+ traveler": "LGBTQ+",
  "Eats halal": "Halal",
  Vegetarian: "Vegetarian",
  "Doesn't drink alcohol": "Sober",
  "Needs step-free access": "Step-free",
  "First time visiting": "First visit",
  "Has been before": "Been before",
} as const;
const PARTY_LABELS = { Solo: "Solo", Couple: "Couple", "Family with kids": "Family", "Group of friends": "Friends" } as const;
const BUDGET_LABELS = { Budget: "$", "Mid-range": "$$", Splurge: "$$$" } as const;
const MODES = ["single", "multi"] as const;
const MODE_LABELS = { single: "One place", multi: "Several stops" } as const;

const blank: TripRequest = {
  mode: "single",
  destination: "",
  days: 3,
  startDate: null,
  party: "Couple",
  age: "25–34",
  about: [],
  budget: "Mid-range",
  interests: ["Food"],
  clubs: false,
  pace: "Balanced",
  extra: "",
  stay: { on: true, styles: ["Boutique"], price: "$$" },
  with: [],
};

/**
 * Plan a trip. Opened from My trips with `from` (plan that trip again), or from Browse with a
 * `destination`, `days` and `mode` to start from (`at` makes the same choice apply again).
 */
export default function Plan() {
  const t = useTheme();
  const params = useLocalSearchParams<{ from?: string; destination?: string; days?: string; mode?: string; at?: string }>();
  // A month to plan for (stops suit the season); "Not sure yet" (null) plans an evergreen trip.
  const [req, setReq] = useState<TripRequest>(() => ({ ...blank, month: soonMonth() }));
  const [months] = useState(upcomingMonths);
  const [more, setMore] = useState(false);
  const [dateText, setDateText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const set = <K extends keyof TripRequest>(k: K, v: TripRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const input = { backgroundColor: t.bg, borderColor: t.line, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, color: t.ink };

  useEffect(() => {
    if (!params.from) return;
    api<{ trip: Trip }>(`/api/trips/${params.from}`)
      .then(({ trip }) => {
        setReq({ ...blank, ...trip.request, stay: { ...trip.request.stay, price: stayTier(trip.request.stay?.price) }, startDate: null, month: travelMonth(trip.request) ?? soonMonth() });
        setTrip(null);
        setMsg({ text: "Loaded your earlier request. Adjust anything, then build." });
      })
      .catch(() => {});
  }, [params.from]);

  useEffect(() => {
    const destination = params.destination?.trim();
    if (!destination) return;
    const mode = params.mode === "multi" ? "multi" : "single";
    const days = Math.round(Number(params.days));
    setReq((r) => ({ ...r, destination, mode, days: Number.isFinite(days) && days >= 1 ? Math.min(days, MAX_DAYS[mode]) : r.days }));
    setTrip(null);
    setMsg(null);
  }, [params.destination, params.days, params.mode, params.at]);

  // Nightlife: get the city's bars and clubs of the moment ready while they finish the form.
  const warmed = useRef(new Set<string>());
  useEffect(() => {
    const dest = req.destination.trim();
    if (req.mode !== "single" || dest.length < 3 || !req.interests.includes("Nightlife")) return;
    const key = dest.toLowerCase();
    if (warmed.current.has(key)) return;
    const t = setTimeout(() => {
      warmed.current.add(key);
      api("/api/nightlife", { method: "POST", json: { destination: dest } }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [req.mode, req.destination, req.interests]);

  // What hotels cost where they're going, so $ to $$$$ can show local prices (cached per place).
  const [scale, setScale] = useState<{ dest: string; scale: StayScale | null } | null>(null);
  useEffect(() => {
    const dest = req.destination.trim();
    if (!req.stay.on || dest.length < 3) return;
    const t = setTimeout(() => {
      api<{ scale: StayScale | null }>(`/api/stay-scale?destination=${encodeURIComponent(dest)}`)
        .then((r) => setScale({ dest, scale: r.scale }))
        .catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [req.destination, req.stay.on]);
  const localScale = scale && scale.dest.toLowerCase() === req.destination.trim().toLowerCase() ? scale.scale : null;

  async function build() {
    if (req.destination.trim().length < 2) return setMsg({ text: "Add a destination first.", err: true });
    setBusy(true);
    setMsg(null);
    try {
      const { trip } = await api<{ trip: Trip }>("/api/trips", { method: "POST", json: req });
      setTrip(trip);
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <H1>Where are you headed?</H1>
        <P muted>Tell us a little about you. We&apos;ll build a trip around what locals actually do.</P>
        <View style={styles.field}>
          <Label>Kind of trip</Label>
          <ChipRow
            options={MODES}
            labels={MODE_LABELS}
            value={[req.mode]}
            single
            onChange={([m]) =>
              m && setReq((r) => ({ ...r, mode: m, days: m === "multi" ? Math.max(r.days, 5) : Math.min(r.days, MAX_DAYS.single) }))
            }
          />
        </View>
        <View style={styles.field}>
          <Label>{req.mode === "multi" ? "Country or region" : "Destination"}</Label>
          <TextInput
            style={input}
            value={req.destination}
            onChangeText={(v) => set("destination", v)}
            placeholder={req.mode === "multi" ? "Egypt, Japan, the Amalfi Coast" : "City or region, e.g. Mexico City"}
            placeholderTextColor={t.muted}
          />
        </View>
        <View style={styles.field}>
          <Label>Days</Label>
          <View style={[styles.row, { borderWidth: 1, borderColor: t.line, borderRadius: 999, alignSelf: "flex-start", backgroundColor: t.bg }]}>
            <Pressable accessibilityLabel="Fewer days" onPress={() => set("days", Math.max(1, req.days - 1))} style={{ padding: 10, paddingHorizontal: 16 }}>
              <Text style={{ color: t.ink, fontSize: 18 }}>−</Text>
            </Pressable>
            <Text style={{ color: t.ink, fontWeight: "600", minWidth: 56, textAlign: "center" }}>
              {req.days} {req.days === 1 ? "day" : "days"}
            </Text>
            <Pressable accessibilityLabel="More days" onPress={() => set("days", Math.min(MAX_DAYS[req.mode], req.days + 1))} style={{ padding: 10, paddingHorizontal: 16 }}>
              <Text style={{ color: t.ink, fontSize: 18 }}>+</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.field}>
          <Label>When</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
            <Chip label="Not sure yet" on={travelMonth(req) == null} onPress={() => !req.startDate && set("month", null)} />
            {months.map((m) => (
              <Chip key={m.value} label={m.label} on={travelMonth(req) === m.value} onPress={() => !req.startDate && set("month", m.value)} />
            ))}
          </ScrollView>
          {req.startDate ? <Text style={{ color: t.muted, fontSize: 13 }}>Set by your start date.</Text> : null}
        </View>
        <View style={styles.field}>
          <Label>Start date (optional, YYYY-MM-DD, for live hotel rates)</Label>
          <TextInput
            style={input}
            value={dateText}
            onChangeText={(v) => {
              setDateText(v);
              const date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
              setReq((r) => ({ ...r, startDate: date, month: date ? Number(date.slice(5, 7)) : r.month }));
            }}
            placeholder="2026-12-01"
            placeholderTextColor={t.muted}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          {!!dateText && !req.startDate && <Status text="Use the format YYYY-MM-DD, or leave it blank." err />}
        </View>
        <View style={styles.field}>
          <Label>Who&apos;s going</Label>
          <ChipRow options={PARTIES} labels={PARTY_LABELS} value={[req.party]} single onChange={([v]) => v && set("party", v)} />
        </View>
        <View style={styles.field}>
          <Label>Age</Label>
          <ChipRow options={AGE_BANDS} value={req.age ? [req.age] : []} single onChange={([v]) => v && set("age", v)} />
        </View>
        <View style={styles.field}>
          <Label>Budget</Label>
          <ChipRow options={BUDGETS} labels={BUDGET_LABELS} value={[req.budget]} single onChange={([v]) => v && set("budget", v)} />
        </View>
        <View style={styles.field}>
          <Label>About you (optional, private to you)</Label>
          <ChipRow options={ABOUT_OPTIONS} labels={ABOUT_LABELS} value={req.about} onChange={(v) => set("about", v)} />
        </View>
        <View style={[styles.row, { justifyContent: "space-between", backgroundColor: t.bg, borderRadius: 12, padding: 12 }]}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: t.ink, fontWeight: "700" }}>Suggest places to stay</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>Three hotel options that fit the trip.</Text>
          </View>
          <Switch value={req.stay.on} onValueChange={(on) => set("stay", { ...req.stay, on })} />
        </View>
        {req.stay.on && (
          <>
            <View style={styles.field}>
              <Label>Style</Label>
              <ChipRow options={STAY_STYLES} value={req.stay.styles} onChange={(styles) => set("stay", { ...req.stay, styles })} />
            </View>
            <View style={styles.field}>
              <Label>Per night</Label>
              <ChipRow
                options={STAY_TIERS}
                labels={Object.fromEntries(STAY_TIERS.map((x) => [x, tierLabel(x, localScale)]))}
                value={[stayTier(req.stay.price)]}
                single
                onChange={([price]) => price && set("stay", { ...req.stay, price })}
              />
              <Text style={{ color: t.muted, fontSize: 13 }}>{localScale ? `What a night for two costs in ${req.destination.trim()}.` : "Judged by local prices."}</Text>
            </View>
          </>
        )}
        <Pressable onPress={() => setMore(!more)}>
          <Text style={{ color: t.accent, fontWeight: "600" }}>{more ? "Fewer preferences" : "More preferences"}</Text>
        </Pressable>
        {more && (
          <>
            <View style={styles.field}>
              <Label>Into</Label>
              <ChipRow
                options={INTERESTS}
                value={req.interests}
                onChange={(v) => setReq((r) => ({ ...r, interests: v, clubs: v.includes("Nightlife") ? r.clubs : false }))}
              />
            </View>
            {/* A night out is drinks; dancing until late is its own ask. */}
            {req.interests.includes("Nightlife") && req.party !== "Family with kids" && (
              <View style={[styles.row, { justifyContent: "space-between", backgroundColor: t.bg, borderRadius: 12, padding: 12 }]}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: "700" }}>Clubs and dancing too</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>Out late at the clubs locals go to. Otherwise nights are drinks at good bars.</Text>
                </View>
                <Switch accessibilityLabel="Clubs and dancing too" value={req.clubs} onValueChange={(clubs) => set("clubs", clubs)} />
              </View>
            )}
            <View style={styles.field}>
              <Label>Pace</Label>
              <ChipRow options={PACES} value={[req.pace]} single onChange={([v]) => v && set("pace", v)} />
            </View>
            <View style={styles.field}>
              <Label>Anything else</Label>
              <TextInput style={[input, { minHeight: 70 }]} multiline maxLength={500} value={req.extra} onChangeText={(v) => set("extra", v)} placeholder="Anniversary trip, hate crowds…" placeholderTextColor={t.muted} />
            </View>
          </>
        )}
        <Button title={busy ? "Building…" : "Build my trip"} disabled={busy} onPress={build} />
        {busy ? <BuildBar days={req.days} /> : <Status text={msg?.text} err={msg?.err} />}
      </Card>
      {trip && <TripView trip={trip} />}
    </Screen>
  );
}
