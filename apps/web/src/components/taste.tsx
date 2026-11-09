"use client";
import {
  DESTINATION_BY_KEY,
  SIGNAL_KIND_LABELS,
  SIGNAL_SOURCE_LABELS,
  flag,
  tasteUnlock,
  type ForYouPick,
  type SignalKind,
  type SignalSource,
  type TasteProfile,
} from "@travel/core";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  /** How you travel, counted from your trips ("24 trips since 2020, about 4 a year."). */
  habits?: string[];
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
  // Stable, so components can depend on it in effects without looping.
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, updating, off, reload };
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

/**
 * What Pylos has learned about your taste: the summary, how you travel, what you like and skip as
 * tags, and where you'd love next (your For you picks, linking to each place). Until a few trips
 * are logged (`trips`, or the count from the taste data), how close the profile is to unlocking,
 * with a way to log the next trip.
 */
export function TasteCard({
  data,
  updating,
  trips,
  onLog,
  picks = [],
}: {
  data: TasteResponse | null;
  updating: boolean;
  trips?: number;
  onLog?: () => void;
  picks?: ForYouPick[];
}) {
  const unlock = tasteUnlock(Math.max(trips ?? 0, data?.counts.pastTrips ?? 0));
  if (!unlock.unlocked) {
    return (
      <section className="card stack taste-card taste-locked" id="taste">
        <div className="head">
          <span className="eyebrow">Your taste</span>
          <h2>
            Log {unlock.need} trips to unlock your taste profile{" "}
            <span className="taste-count tabnum">
              · {unlock.have} of {unlock.need}
            </span>
          </h2>
          <p className="hint">
            Tick the places you loved on each one. Pylos then predicts the hotels and restaurants you&apos;ll love, and marks them &quot;For you&quot; in your plans.
          </p>
        </div>
        <div className="bar thin" role="progressbar" aria-valuemin={0} aria-valuemax={unlock.need} aria-valuenow={unlock.have} aria-label="Trips logged toward your taste profile">
          <span style={{ width: `${Math.max(4, Math.round((unlock.have / unlock.need) * 100))}%` }} />
        </div>
        {onLog && (
          <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={onLog}>
            Log a trip
          </button>
        )}
      </section>
    );
  }
  const p = data?.profile;
  const facts = data?.habits ?? [];
  const groups = p
    ? [
        { label: "Stays", tags: [...p.stays.styles, ...p.stays.likes] },
        { label: "Food and drink", tags: [...p.food.cuisines, ...p.food.vibes] },
        { label: "Likes doing", tags: p.activities },
      ].filter((g) => g.tags.length)
    : [];
  const avoid = p ? [...p.stays.avoid, ...p.food.avoid] : [];
  const next = picks.map((pk) => ({ pick: pk, d: DESTINATION_BY_KEY[pk.key] })).filter((x) => !!x.d).slice(0, 3);
  return (
    <section className="card taste-card" id="taste" aria-busy={updating}>
      <div className="head">
        <span className="eyebrow">What Pylos has learned</span>
        {p?.summary ? (
          <p className="taste-summary">{p.summary}</p>
        ) : (
          <>
            <h2>Teach Pylos your taste</h2>
            <p className="hint">
              Log a few past trips with where you stayed and ate, or connect an account. Pylos uses it to predict the hotels and restaurants you&apos;ll love, and marks them
              &quot;For you&quot; in your plans.
            </p>
          </>
        )}
      </div>
      {!!(facts.length || p?.style?.length) && (
        <div className="taste-block">
          <span className="label">How you travel</span>
          {facts.length > 0 && (
            <ul className="taste-facts">
              {facts.map((f) => (
                <li key={f}>{f.replace(/\.$/, "")}</li>
              ))}
            </ul>
          )}
          {!!p?.style?.length && (
            <ul className="notes">
              {p.style.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(groups.length > 0 || avoid.length > 0) && (
        <div className="taste-groups">
          {groups.map((g) => (
            <div key={g.label} className="taste-block">
              <span className="label">{g.label}</span>
              <ul className="tags">
                {g.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
          {avoid.length > 0 && (
            <div className="taste-block">
              <span className="label">Not for you</span>
              <ul className="tags avoid">
                {avoid.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {(next.length > 0 || !!p?.next?.length) && (
        <div className="taste-block">
          <span className="label">Where you&apos;d love next</span>
          {next.length ? (
            <div className="next-grid">
              {next.map(({ pick, d }) => (
                <Link key={pick.key} className="next-card" href={`/?d=${pick.key}`}>
                  <span className="eyebrow">
                    <span aria-hidden="true">{flag(d!.countryCode)}</span> {d!.country}
                  </span>
                  <b>{d!.name}</b>
                  <span>{pick.why}</span>
                </Link>
              ))}
            </div>
          ) : (
            <ul className="notes">
              {p!.next!.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {data && <TasteSources data={data} updating={updating} />}
    </section>
  );
}

/** "Learned from 8 trips, 46 places and 6 thumbs", then where they came from, with counts. */
function TasteSources({ data, updating }: { data: TasteResponse; updating: boolean }) {
  if (updating) return <p className="hint">Updating with your latest places…</p>;
  const parts = [
    data.counts.pastTrips ? `${data.counts.pastTrips} ${data.counts.pastTrips === 1 ? "trip" : "trips"}` : "",
    data.counts.total ? `${data.counts.total} ${data.counts.total === 1 ? "place" : "places"}` : "",
    data.counts.thumbs ? `${data.counts.thumbs} thumbs on Pylos plans` : "",
  ].filter(Boolean);
  const sources = (Object.entries(data.counts.bySource) as [SignalSource, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="taste-from">
      <p className="hint">
        Learned from {parts.length ? parts.slice(0, -1).join(", ") + (parts.length > 1 ? " and " : "") + parts[parts.length - 1] : "nothing yet"}.
      </p>
      {sources.length > 0 && (
        <ul className="taste-sources" aria-label="Where it came from">
          {sources.map(([s, n]) => (
            <li key={s}>
              {SIGNAL_SOURCE_LABELS[s]} <b className="tabnum">{n}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
