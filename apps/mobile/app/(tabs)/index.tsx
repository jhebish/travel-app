import {
  ABOUT_OPTIONS,
  AGE_BANDS,
  BUDGETS,
  INTERESTS,
  PACES,
  PARTIES,
  STAY_PRICES,
  STAY_STYLES,
  type Trip,
  type TripRequest,
} from "@travel/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { api } from "../../src/api";
import { useTheme } from "../../src/theme";
import { TripView } from "../../src/TripView";
import { Button, Card, ChipRow, H1, Label, BuildBar, Loading, P, Screen, Status, styles } from "../../src/ui";

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

const blank: TripRequest = {
  destination: "",
  days: 3,
  startDate: null,
  party: "Couple",
  age: "25–34",
  about: [],
  budget: "Mid-range",
  interests: ["Food"],
  pace: "Balanced",
  extra: "",
  stay: { on: true, styles: ["Boutique"], price: "$150–300" },
};

export default function Plan() {
  const t = useTheme();
  const params = useLocalSearchParams<{ from?: string }>();
  const [req, setReq] = useState<TripRequest>(blank);
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
        setReq({ ...blank, ...trip.request, startDate: null });
        setTrip(null);
        setMsg({ text: "Loaded your earlier request. Adjust anything, then build." });
      })
      .catch(() => {});
  }, [params.from]);

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
          <Label>Destination</Label>
          <TextInput style={input} value={req.destination} onChangeText={(v) => set("destination", v)} placeholder="City or region, e.g. Mexico City" placeholderTextColor={t.muted} />
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
            <Pressable accessibilityLabel="More days" onPress={() => set("days", Math.min(7, req.days + 1))} style={{ padding: 10, paddingHorizontal: 16 }}>
              <Text style={{ color: t.ink, fontSize: 18 }}>+</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.field}>
          <Label>Start date (optional, YYYY-MM-DD, for live hotel rates)</Label>
          <TextInput
            style={input}
            value={dateText}
            onChangeText={(v) => {
              setDateText(v);
              set("startDate", /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
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
              <ChipRow options={STAY_PRICES} value={[req.stay.price]} single onChange={([price]) => price && set("stay", { ...req.stay, price })} />
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
              <ChipRow options={INTERESTS} value={req.interests} onChange={(v) => set("interests", v)} />
            </View>
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
