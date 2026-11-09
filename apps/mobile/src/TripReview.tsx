import { countryName } from "@travel/core";
import { useState } from "react";
import { View } from "react-native";
import type { FoundHotel, FoundTrip } from "./deviceImports";
import { useTheme } from "./theme";
import { Button, Card, H2, Label, P, Status, Text } from "./ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Portugal · May 2023 · 4 days" */
function detail(t: FoundTrip): string {
  const when = [t.month ? MONTHS[t.month - 1] : null, t.year].filter(Boolean).join(" ");
  const days = t.days ? `${t.days} ${t.days === 1 ? "day" : "days"}` : "";
  return [countryName(t.countryCode), when, days].filter(Boolean).join(" · ");
}

/** "Lisbon · May 2023 · 4 nights" */
function hotelDetail(h: FoundHotel): string {
  const m = Number(h.date.slice(5, 7));
  const when = m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${h.date.slice(0, 4)}` : h.date.slice(0, 4);
  return [h.city, when, `${h.nights} ${h.nights === 1 ? "night" : "nights"}`].filter(Boolean).join(" · ");
}

const newestFirst = (a: FoundTrip, b: FoundTrip) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0) || a.city.localeCompare(b.city);

/** A row that can be taken out of the list (and put back) before saving. */
function Row({ title, sub, off, first, onToggle, disabled }: { title: string; sub: string; off: boolean; first: boolean; onToggle: () => void; disabled: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: t.line, paddingTop: first ? 0 : 14 }}>
      <View style={{ flex: 1, opacity: off ? 0.45 : 1 }}>
        <Text style={{ color: t.ink, fontWeight: "600", fontSize: 17.5, textDecorationLine: off ? "line-through" : "none" }}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 15 }}>{sub}</Text>
      </View>
      {/* Wrapped: a ghost button aligns itself to the top, and this keeps it centred on the row. */}
      <View>
        <Button ghost title={off ? "Put back" : "Remove"} onPress={onToggle} disabled={disabled} />
      </View>
    </View>
  );
}

/**
 * The trips (and, from photos, the hotels) a scan found, before any of them are saved: each can
 * be removed (and put back), and only the ones kept go into Places you've been and Places you've
 * stayed.
 */
export function TripReview({
  trips,
  hotels = [],
  source,
  note,
  onSave,
  onSkip,
}: {
  trips: FoundTrip[];
  hotels?: FoundHotel[];
  source: "photos" | "calendar";
  /** A line under the list ("You shared only some photos…"). */
  note?: string | null;
  /** Save the kept trips and hotels. A rejection is shown here, and the list stays as it is. */
  onSave: (kept: FoundTrip[], keptHotels: FoundHotel[]) => Promise<void>;
  onSkip: () => void;
}) {
  const t = useTheme();
  const [list] = useState(() => [...trips].sort(newestFirst));
  const [removed, setRemoved] = useState<Set<number>>(() => new Set());
  const [removedHotels, setRemovedHotels] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kept = list.filter((_, i) => !removed.has(i));
  const keptHotels = hotels.filter((_, i) => !removedHotels.has(i));
  const years = list.map((x) => x.year).filter((y): y is number => !!y);
  const since = years.length ? Math.min(...years) : null;
  const n = list.length;
  const flip = (set: (f: (s: Set<number>) => Set<number>) => void, i: number) =>
    set((had) => {
      const next = new Set(had);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await onSave(kept, keptHotels);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  const total = kept.length + keptHotels.length;
  const saveLabel = !total
    ? "None to add"
    : [kept.length ? `${kept.length} ${kept.length === 1 ? "trip" : "trips"}` : "", keptHotels.length ? `${keptHotels.length} ${keptHotels.length === 1 ? "hotel" : "hotels"}` : ""]
        .filter(Boolean)
        .join(" and ");

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
        {list.map((trip, i) => (
          <Row key={`${trip.city}|${trip.year}|${i}`} title={trip.city} sub={detail(trip)} off={removed.has(i)} first={i === 0} onToggle={() => flip(setRemoved, i)} disabled={saving} />
        ))}
      </View>
      {hotels.length ? (
        <View style={{ gap: 14, paddingTop: 6 }}>
          <View style={{ gap: 4 }}>
            <Label>Hotels you stayed at</Label>
            <Text style={{ color: t.muted, fontSize: 15 }}>
              Where your photos were taken at night. A rental or a friend&apos;s place can look like the hotel next door, so remove any that aren&apos;t right.
            </Text>
          </View>
          {hotels.map((h, i) => (
            <Row key={`${h.placeId}|${h.date}`} title={h.name} sub={hotelDetail(h)} off={removedHotels.has(i)} first={i === 0} onToggle={() => flip(setRemovedHotels, i)} disabled={saving} />
          ))}
        </View>
      ) : null}
      {note ? <P muted>{note}</P> : null}
      <Status text={err} err />
      <Button title={saving ? "Adding…" : total ? `Add ${saveLabel}` : saveLabel} onPress={() => void save()} disabled={saving || !total} />
      <Button ghost title="Skip these" onPress={onSkip} disabled={saving} />
    </Card>
  );
}
