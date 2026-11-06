"use client";
import { SIGNAL_KIND_LABELS, SIGNAL_SOURCE_LABELS, type SignalKind, type SignalSource, type TasteProfile } from "@travel/core";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { IconDown, IconUp } from "./icons";

export interface PlaceItem {
  kind: SignalKind;
  name: string;
  liked: boolean | null;
}

const ITEM_KINDS: SignalKind[] = ["stay", "food", "drink", "coffee", "nightlife", "sight", "activity", "shop"];
const PLACEHOLDER: Record<SignalKind, string> = {
  stay: "Hotel or place you stayed",
  food: "Restaurant",
  drink: "Bar",
  coffee: "Café",
  nightlife: "Club or music venue",
  sight: "Museum, landmark, beach…",
  activity: "Tour, hike, class…",
  shop: "Shop or market",
  city: "City",
};
const QUICK: { kind: SignalKind; label: string }[] = [
  { kind: "stay", label: "Hotel" },
  { kind: "food", label: "Restaurant" },
  { kind: "drink", label: "Bar" },
  { kind: "activity", label: "Something we did" },
];

/**
 * "What did you do there?": the hotels, restaurants and spots from one past trip, each with an
 * optional thumbs up or down. This is the strongest signal Pylos has for predicting what you'll like.
 */
export function PlaceItemsEditor({
  items,
  onChange,
  suggestions = [],
}: {
  items: PlaceItem[];
  onChange: (items: PlaceItem[]) => void;
  /** Places from the Pylos plan for this trip: tap to add the ones you actually went to. */
  suggestions?: PlaceItem[];
}) {
  const set = (i: number, patch: Partial<PlaceItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const has = (name: string) => items.some((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
  const open = suggestions.filter((s) => !has(s.name));
  return (
    <div className="field items-editor">
      <span className="label">
        What did you do there? <small>(where you stayed, ate and went: this is what teaches Pylos your taste)</small>
      </span>
      {open.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="hint">From your Pylos plan: tap the ones you went to.</span>
          <div className="chips">
            {open.slice(0, 16).map((s) => (
              <button key={s.name} type="button" className="chip" onClick={() => onChange([...items, { ...s, liked: true }])}>
                + {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {items.map((it, i) => (
        <div className="item-row" key={i}>
          <select aria-label="What kind of place" value={it.kind} onChange={(e) => set(i, { kind: e.target.value as SignalKind })}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {SIGNAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <input type="text" aria-label="Place name" placeholder={PLACEHOLDER[it.kind]} value={it.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} />
          <span className="item-thumbs" role="group" aria-label={`How was ${it.name || "it"}`}>
            <button type="button" className="iconbtn up" aria-pressed={it.liked === true} aria-label="Loved it" onClick={() => set(i, { liked: it.liked === true ? null : true })}>
              <IconUp />
            </button>
            <button type="button" className="iconbtn down" aria-pressed={it.liked === false} aria-label="Not for me" onClick={() => set(i, { liked: it.liked === false ? null : false })}>
              <IconDown />
            </button>
            <button type="button" className="iconbtn" aria-label={`Remove ${it.name || "this place"}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        </div>
      ))}
      <div className="row tight item-add">
        {QUICK.map((q) => (
          <button key={q.kind} type="button" className="chip" onClick={() => onChange([...items, { kind: q.kind, name: "", liked: null }])}>
            + {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface TasteSignalDTO {
  id: string;
  pastTripId: string | null;
  source: SignalSource;
  kind: SignalKind;
  name: string;
  city?: string | null;
  rating?: number | null;
  liked?: boolean | null;
}
export interface TasteResponse {
  profile: TasteProfile | null;
  stale: boolean;
  evidence: number;
  counts: { total: number; bySource: Record<SignalSource, number>; pastTrips: number; thumbs: number };
  signals: TasteSignalDTO[];
}

/** Load your taste; when it's out of date, rebuild it in the background. Call `reload` after changes. */
export function useTaste(enabled: boolean) {
  const [data, setData] = useState<TasteResponse | null>(null);
  const [updating, setUpdating] = useState(false);
  const [off, setOff] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api<TasteResponse>("/api/taste")
      .then(async (r) => {
        if (!alive) return;
        setData(r);
        if (r.stale) {
          setUpdating(true);
          const { profile } = await api<{ profile: TasteProfile | null }>("/api/taste/refresh", { method: "POST" });
          if (alive) setData((d) => (d ? { ...d, profile, stale: false } : d));
        }
      })
      .catch(() => alive && setOff(true))
      .finally(() => alive && setUpdating(false));
    return () => {
      alive = false;
    };
  }, [enabled, version]);
  return { data, updating, off, reload: () => setVersion((v) => v + 1) };
}

/** A rough guess of what kind of place a plan's stop is, for "did you go?" suggestions. */
export function kindFromName(name: string): SignalKind {
  const n = name.toLowerCase();
  if (/hotel|hostel|riad|inn\b|suites|resort|guesthouse|pousada|posada/.test(n)) return "stay";
  if (/caf[eé]|coffee|espresso|roaster/.test(n)) return "coffee";
  if (/\bbar\b|wine|cocktail|pub\b|taberna|brewery|enoteca/.test(n)) return "drink";
  if (/museum|gallery|church|cathedral|mosque|temple|shrine|palace|castle|park|garden|beach|tower|monument|ruins/.test(n)) return "sight";
  if (/market|shop|store|boutique|books/.test(n)) return "shop";
  if (/tour|hike|class|spa|hammam|walk|cruise|felucca/.test(n)) return "activity";
  return "food";
}

/** What Pylos has learned about your taste. */
export function TasteCard({ data, updating }: { data: TasteResponse | null; updating: boolean }) {
  const p = data?.profile;
  const sources = data ? (Object.entries(data.counts.bySource) as [SignalSource, number][]).filter(([, n]) => n > 0) : [];
  return (
    <section className="card stack taste-card" aria-busy={updating}>
      <div className="head">
        <span className="eyebrow">Your taste</span>
        <h2>{p ? "What Pylos has learned" : "Teach Pylos your taste"}</h2>
        {p?.summary ? (
          <p className="lede">{p.summary}</p>
        ) : (
          <p className="hint">
            Log a few past trips with where you stayed and ate, or connect an account below. Pylos uses it to predict the hotels and restaurants you&apos;ll love, and marks
            them &quot;For you&quot; in your plans.
          </p>
        )}
      </div>
      {p && (
        <div className="taste-grid">
          {!!(p.stays.styles.length || p.stays.likes.length) && (
            <div>
              <span className="label">Stays</span>
              <p>{[...p.stays.styles, ...p.stays.likes].join(" · ")}</p>
            </div>
          )}
          {!!(p.food.cuisines.length || p.food.vibes.length) && (
            <div>
              <span className="label">Food and drink</span>
              <p>{[...p.food.cuisines, ...p.food.vibes].join(" · ")}</p>
            </div>
          )}
          {!!p.activities.length && (
            <div>
              <span className="label">Likes doing</span>
              <p>{p.activities.join(" · ")}</p>
            </div>
          )}
          {!!(p.stays.avoid.length || p.food.avoid.length) && (
            <div>
              <span className="label">Not for you</span>
              <p>{[...p.stays.avoid, ...p.food.avoid].join(" · ")}</p>
            </div>
          )}
        </div>
      )}
      {data && (
        <p className="hint">
          {updating
            ? "Updating with your latest places…"
            : `Learned from ${[
                data.counts.pastTrips ? `${data.counts.pastTrips} ${data.counts.pastTrips === 1 ? "trip" : "trips"}` : "",
                data.counts.total ? `${data.counts.total} ${data.counts.total === 1 ? "place" : "places"}` : "",
                data.counts.thumbs ? `${data.counts.thumbs} thumbs on Pylos plans` : "",
              ]
                .filter(Boolean)
                .join(", ") || "nothing yet"}${sources.length ? ` (${sources.map(([s, n]) => `${SIGNAL_SOURCE_LABELS[s]} ${n}`).join(", ")})` : ""}.`}
        </p>
      )}
    </section>
  );
}
