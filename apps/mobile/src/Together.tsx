import type { PersonDTO, Together, TripPerson } from "@travel/core";
import { useState } from "react";
import { Share, View } from "react-native";
import { api } from "./api";
import { useTheme } from "./theme";
import { Button, Loading, Status, Text } from "./ui";

/** Who's in for a stop, under it: "In: Sara, you". */
export function WhoIsIn({ people, by }: { people: TripPerson[]; by?: Record<string, 1 | -1> }) {
  const t = useTheme();
  const ins = people.filter((p) => by?.[p.userId] === 1);
  const passes = people.filter((p) => by?.[p.userId] === -1);
  if (!ins.length && !passes.length) return null;
  const names = (ps: TripPerson[]) => ps.map((p) => (p.me ? "you" : p.name)).join(", ");
  return (
    <Text style={{ color: t.muted, fontSize: 14 }}>
      {ins.length ? <Text style={{ color: t.good, fontWeight: "600" }}>In: {names(ins)}</Text> : null}
      {ins.length && passes.length ? " · " : ""}
      {passes.length ? `Pass: ${names(passes)}` : null}
    </Text>
  );
}

/**
 * Plan together, as on the site: who's planning this trip, an invite link to send, friends to add
 * straight in, and removing someone (or leaving, for a friend on someone else's trip).
 */
export function TogetherPanel({
  tripId,
  isOwner,
  together,
  friends,
  onChange,
  onLeft,
}: {
  tripId: string;
  isOwner: boolean;
  together: Together | null;
  friends: PersonDTO[];
  onChange: (t: Together) => void;
  onLeft: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const people = together?.people ?? [];
  const inTrip = new Set(people.map((p) => p.userId));

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const invite = () =>
    run("invite", async () => {
      const { url } = await api<{ url: string }>(`/api/trips/${tripId}/together`, { method: "POST", json: { action: "invite" } });
      await Share.share({ message: `Plan this trip with me on Pylos: ${url}`, url }).catch(() => {});
    });
  const add = (handle: string) =>
    run(handle, async () => {
      const { together: next } = await api<{ together: Together }>(`/api/trips/${tripId}/together`, { method: "POST", json: { action: "add", handle } });
      onChange(next);
    });
  const remove = (p: TripPerson) =>
    run(p.userId, async () => {
      await api(`/api/trips/${tripId}/together/people/${p.userId}`, { method: "DELETE" });
      if (p.me) return onLeft();
      if (together) onChange({ ...together, people: together.people.filter((x) => x.userId !== p.userId) });
    });

  return (
    <View style={{ backgroundColor: t.sunk, borderRadius: 16, padding: 14, gap: 12 }}>
      <Text style={{ color: t.muted, fontSize: 14.5 }}>
        Friends you add can see this plan, say which stops they&apos;re in for, swap stops and rebuild days. Pylos plans around everyone&apos;s taste.
      </Text>
      {!together ? (
        <Loading text="Loading who's planning…" />
      ) : (
        <View style={{ gap: 10 }}>
          {people.map((p) => (
            <View key={p.userId} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>{p.me ? "You" : p.name}</Text>
                <Text style={{ color: t.muted, fontSize: 13.5 }}>{p.owner ? "Organizer" : "Planning with you"}</Text>
              </View>
              {(isOwner && !p.owner) || (!isOwner && p.me) ? (
                <Button ghost danger title={p.me ? "Leave trip" : "Remove"} disabled={!!busy} onPress={() => void remove(p)} />
              ) : null}
            </View>
          ))}
          {people.length <= 1 ? <Text style={{ color: t.muted, fontSize: 15 }}>Just you so far.</Text> : null}
        </View>
      )}
      {isOwner ? (
        <>
          <Button title={busy === "invite" ? "Making a link…" : "Send an invite link"} disabled={!!busy} onPress={() => void invite()} />
          <Text style={{ color: t.muted, fontSize: 13.5 }}>
            Anyone with the link can join the planning for two weeks. They don&apos;t need an account. Removing someone turns off the links you&apos;ve made.
          </Text>
          {friends.filter((f) => !inTrip.has(f.userId)).length ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.ink, fontWeight: "700", fontSize: 15 }}>Add a friend</Text>
              {friends
                .filter((f) => !inTrip.has(f.userId))
                .slice(0, 8)
                .map((f) => (
                  <View key={f.userId} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <Text style={{ color: t.ink, fontSize: 15.5, flexShrink: 1 }}>
                      {f.displayName} <Text style={{ color: t.muted }}>@{f.handle}</Text>
                    </Text>
                    <Button ghost title={busy === f.handle ? "Adding…" : "Add"} disabled={!!busy} onPress={() => void add(f.handle)} />
                  </View>
                ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={{ color: t.muted, fontSize: 14 }}>Want to bring someone else in? Ask the organizer for an invite link.</Text>
      )}
      <Status text={err} err />
    </View>
  );
}
