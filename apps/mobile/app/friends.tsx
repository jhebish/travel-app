import { ASK_MAX_PLACES, firstName, type AskDTO, type AskPlace, type SignalKind } from "@travel/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import { api } from "../src/api";
import { useTheme } from "../src/theme";
import { Button, Card, Chip, H2, Label, Loading, P, Screen, Status, styles, Text } from "../src/ui";

/**
 * Friends' questions: answer what friends asked you about a city (a few words and up to 12
 * places) or decline, and see the answers to yours. Opened from the You tab, or a notification
 * (/friends?ask=<id>).
 */

type Chosen = { name: string; kind?: SignalKind | null; note: string; signalId?: string };
type MyPlace = { id: string; name: string; kind: SignalKind };

function Places({ places }: { places: AskPlace[] }) {
  const t = useTheme();
  if (!places.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {places.map((p) => (
        <View key={p.name} style={styles.row}>
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: "600", flexShrink: 1 }}>{p.name}</Text>
          {p.note ? <Text style={{ color: t.muted, fontSize: 15, flexShrink: 1 }}>{p.note}</Text> : null}
          {p.mapsUrl ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(p.mapsUrl!).catch(() => {})}>
              <Text style={{ color: t.accent, fontSize: 14, fontWeight: "600" }}>Map</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function AnswerForm({ ask, onDone, onCancel }: { ask: AskDTO; onDone: (a: AskDTO) => void; onCancel: () => void }) {
  const t = useTheme();
  const input = { backgroundColor: t.bg, borderColor: t.line, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, color: t.ink };
  const [mine, setMine] = useState<MyPlace[] | null>(null);
  const [text, setText] = useState(ask.answer);
  const [chosen, setChosen] = useState<Chosen[]>(ask.places.map((p) => ({ name: p.name, kind: p.kind, note: p.note })));
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ myPlaces: MyPlace[] }>(`/api/asks/${ask.id}`)
      .then((r) => setMine(r.myPlaces))
      .catch(() => setMine([]));
  }, [ask.id]);
  const full = chosen.length >= ASK_MAX_PLACES;
  const has = (name: string) => chosen.some((c) => c.name.toLowerCase() === name.toLowerCase());
  const addTyped = () => {
    const n = typed.trim().slice(0, 120);
    if (!n || has(n) || full) return;
    setChosen((cs) => [...cs, { name: n, note: "" }]);
    setTyped("");
  };
  async function send() {
    if (!text.trim() && !chosen.length) return setErr("Write a few words or add a place first.");
    setBusy(true);
    setErr(null);
    try {
      const { ask: a } = await api<{ ask: AskDTO }>(`/api/asks/${ask.id}`, { method: "POST", json: { action: "answer", answer: text.trim(), places: chosen } });
      onDone(a);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Label>Your answer</Label>
      <TextInput
        style={[input, { minHeight: 80, textAlignVertical: "top" }]}
        multiline
        maxLength={1500}
        value={text}
        onChangeText={setText}
        placeholder={`What should ${firstName(ask.person.displayName)} not miss?`}
        placeholderTextColor={t.muted}
      />
      <Label>Places (up to {ASK_MAX_PLACES})</Label>
      {mine === null ? (
        <Loading text="Loading the places you've logged…" />
      ) : mine.length ? (
        <View style={styles.wrap}>
          {mine.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              on={has(p.name)}
              onPress={() =>
                setChosen((cs) => (has(p.name) ? cs.filter((c) => c.name.toLowerCase() !== p.name.toLowerCase()) : full ? cs : [...cs, { name: p.name, kind: p.kind, note: "", signalId: p.id }]))
              }
            />
          ))}
        </View>
      ) : (
        <P muted>You haven&apos;t logged places in {ask.city}. Type them in below.</P>
      )}
      <View style={[styles.row, { flexWrap: "nowrap" }]}>
        <TextInput style={[input, { flex: 1 }]} value={typed} onChangeText={setTyped} onSubmitEditing={addTyped} placeholder="Add a place by name" placeholderTextColor={t.muted} maxLength={120} editable={!full} />
        <Button ghost title="Add" onPress={addTyped} disabled={!typed.trim() || full} />
      </View>
      {chosen.map((c) => (
        <View key={c.name} style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={{ color: t.ink, fontSize: 16, flexShrink: 1 }}>{c.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} onPress={() => setChosen((cs) => cs.filter((x) => x !== c))}>
            <Text style={{ color: t.accent, fontSize: 14, fontWeight: "600" }}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Button title={busy ? "Sending…" : `Send to ${firstName(ask.person.displayName)}`} onPress={send} disabled={busy} />
      <Button ghost title="Cancel" onPress={onCancel} />
      <Status text={err} err />
    </View>
  );
}

export default function FriendsQuestions() {
  const t = useTheme();
  const router = useRouter();
  const { ask: focus } = useLocalSearchParams<{ ask?: string }>();
  const [data, setData] = useState<{ received: AskDTO[]; sent: AskDTO[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const load = useCallback(() => {
    api<{ received: AskDTO[]; sent: AskDTO[] }>("/api/asks")
      .then((d) => {
        setData(d);
        if (focus && d.received.some((a) => a.id === focus && a.status === "open")) setOpen(focus);
      })
      .catch((e) => setMsg({ text: (e as Error).message, err: true }));
  }, [focus]);
  useEffect(load, [load]);

  const put = (a: AskDTO) => setData((d) => (d ? { ...d, received: d.received.map((x) => (x.id === a.id ? a : x)) } : d));
  async function decline(a: AskDTO) {
    try {
      await api(`/api/asks/${a.id}`, { method: "POST", json: { action: "decline" } });
      setData((d) => (d ? { ...d, received: d.received.filter((x) => x.id !== a.id) } : d));
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Friends' questions" }} />
      {!data ? (
        <Loading text="Loading questions…" />
      ) : !data.received.length && !data.sent.length ? (
        <Card>
          <H2>No questions yet</H2>
          <P muted>When a friend asks you about a city you&apos;ve been to, it shows up here. You can ask friends from the planner on the Pylos website.</P>
        </Card>
      ) : null}
      {data && data.received.length > 0 && (
        <Card>
          <H2>Questions for you</H2>
          {data.received.map((a) => (
            <View key={a.id} style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderColor: t.line, backgroundColor: focus === a.id ? t.accentSoft : undefined, borderRadius: focus === a.id ? 10 : 0 }}>
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: "700" }}>
                {a.person.displayName} <Text style={{ color: t.muted, fontWeight: "400" }}>asked about {a.city}</Text>
              </Text>
              <P>{a.question}</P>
              {open === a.id ? (
                <AnswerForm
                  ask={a}
                  onCancel={() => setOpen(null)}
                  onDone={(x) => {
                    put(x);
                    setOpen(null);
                    setMsg({ text: `Sent. It's saved in ${firstName(a.person.displayName)}'s trip.` });
                  }}
                />
              ) : a.status === "open" ? (
                <View style={styles.row}>
                  <Button ghost title="Answer" onPress={() => setOpen(a.id)} />
                  <Button ghost title="Not this time" onPress={() => decline(a)} />
                </View>
              ) : (
                <View style={{ gap: 6 }}>
                  <Text style={{ color: t.muted, fontSize: 14 }}>You answered</Text>
                  {a.answer ? <P>{a.answer}</P> : null}
                  <Places places={a.places} />
                  <Button ghost title="Edit your answer" onPress={() => setOpen(a.id)} />
                </View>
              )}
            </View>
          ))}
        </Card>
      )}
      {data && data.sent.length > 0 && (
        <Card>
          <H2>Your questions</H2>
          {data.sent.map((a) => (
            <View key={a.id} style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderColor: t.line }}>
              <Text style={{ color: t.ink, fontSize: 16 }}>
                You asked <Text style={{ fontWeight: "700" }}>{a.person.displayName}</Text> about {a.city}
                {a.isNew ? <Text style={{ color: t.good, fontWeight: "700" }}> · New</Text> : null}
              </Text>
              {a.status === "answered" ? (
                <>
                  {a.answer ? <P>{a.answer}</P> : null}
                  <Places places={a.places} />
                  {a.tripId ? <Button ghost title="Open your trip" onPress={() => router.push(`/trip/${a.tripId}`)} /> : null}
                </>
              ) : a.status === "declined" ? (
                <P muted>{firstName(a.person.displayName)} can&apos;t help with this one.</P>
              ) : (
                <P muted>No answer yet.</P>
              )}
            </View>
          ))}
        </Card>
      )}
      <Status text={msg?.text} err={msg?.err} />
    </Screen>
  );
}
