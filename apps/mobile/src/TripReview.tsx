import { countryName } from "@travel/core";
import { useState } from "react";
import { View } from "react-native";
import type { FoundTrip } from "./deviceImports";
import { useTheme } from "./theme";
import { Button, Card, H2, P, Status, Text } from "./ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Portugal · May 2023 · 4 days" */
function detail(t: FoundTrip): string {
  const when = [t.month ? MONTHS[t.month - 1] : null, t.year].filter(Boolean).join(" ");
  const days = t.days ? `${t.days} ${t.days === 1 ? "day" : "days"}` : "";
  return [countryName(t.countryCode), when, days].filter(Boolean).join(" · ");
}

const newestFirst = (a: FoundTrip, b: FoundTrip) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0) || a.city.localeCompare(b.city);

/**
 * The trips a photo or calendar scan found, before any of them go into Places you've been: each
 * can be removed (and put back), and only the ones kept are saved.
 */
export function TripReview({
  trips,
  source,
  note,
  onSave,
  onSkip,
}: {
  trips: FoundTrip[];
  source: "photos" | "calendar";
  /** A line under the list ("You shared only some photos…"). */
  note?: string | null;
  /** Save the kept trips. A rejection is shown here, and the list stays as it is. */
  onSave: (kept: FoundTrip[]) => Promise<void>;
  onSkip: () => void;
}) {
  const t = useTheme();
  const [list] = useState(() => [...trips].sort(newestFirst));
  const [removed, setRemoved] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kept = list.filter((_, i) => !removed.has(i));
  const years = list.map((x) => x.year).filter((y): y is number => !!y);
  const since = years.length ? Math.min(...years) : null;
  const n = list.length;

  const toggle = (i: number) =>
    setRemoved((had) => {
      const next = new Set(had);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await onSave(kept);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Card>
      <H2>
        We found {n} {n === 1 ? "trip" : "trips"}
        {since ? (n === 1 ? `, in ${since}` : ` since ${since}`) : ""}
      </H2>
      <P muted>
        {source === "photos" ? "From where and when your photos were taken." : "From the flights, stays and bookings in your calendar."} Remove any that aren&apos;t
        right; the rest go into Places you&apos;ve been.
      </P>
      <View style={{ gap: 14 }}>
        {list.map((trip, i) => {
          const off = removed.has(i);
          return (
            <View key={`${trip.city}|${trip.year}|${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, paddingTop: i ? 14 : 0 }}>
              <View style={{ flex: 1, opacity: off ? 0.45 : 1 }}>
                <Text style={{ color: t.ink, fontWeight: "600", fontSize: 17.5, textDecorationLine: off ? "line-through" : "none" }}>{trip.city}</Text>
                <Text style={{ color: t.muted, fontSize: 15 }}>{detail(trip)}</Text>
              </View>
              {/* Wrapped: a ghost button aligns itself to the top, and this keeps it centred on the row. */}
              <View>
                <Button ghost title={off ? "Put back" : "Remove"} onPress={() => toggle(i)} disabled={saving} />
              </View>
            </View>
          );
        })}
      </View>
      {note ? <P muted>{note}</P> : null}
      <Status text={err} err />
      <Button
        title={saving ? "Adding…" : kept.length ? `Add ${kept.length} ${kept.length === 1 ? "trip" : "trips"}` : "None to add"}
        onPress={() => void save()}
        disabled={saving || !kept.length}
      />
      <Button ghost title="Skip these" onPress={onSkip} disabled={saving} />
    </Card>
  );
}
