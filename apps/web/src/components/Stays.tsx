"use client";
import { SIGNAL_SOURCE_LABELS, countryName, stayWhen, type PastStay } from "@travel/core";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** "Lisbon, Portugal · May 2025 · 2 stays" */
const stayLine = (s: PastStay) =>
  [[s.city, s.countryCode ? countryName(s.countryCode) : null].filter(Boolean).join(", "), stayWhen(s), s.visits > 1 ? `${s.visits} stays` : ""].filter(Boolean).join(" · ");

/**
 * Places you've stayed: every hotel and rental the calendar, email and photo scans found and the
 * ones you added, as one list. Loved it / not for me steers hotel picks; remove what's wrong.
 */
export function StaysList({ version = 0 }: { version?: number }) {
  const [stays, setStays] = useState<PastStay[] | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ stays: PastStay[] }>("/api/taste/stays")
      .then((r) => setStays(r.stays))
      .catch(() => setStays(null));
  }, [version]);
  if (!stays?.length) return null;

  async function run(s: PastStay, fn: () => Promise<void>) {
    setBusy(s.ids[0]!);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const rate = (s: PastStay, liked: boolean | null) =>
    run(s, async () => {
      await Promise.all(s.ids.map((id) => api(`/api/taste/signals/${id}`, { method: "PATCH", json: { liked } })));
      setStays((list) => list?.map((x) => (x === s ? { ...x, liked } : x)) ?? null);
    });
  const remove = (s: PastStay) =>
    run(s, async () => {
      await Promise.all(s.ids.map((id) => api(`/api/taste/signals/${id}`, { method: "DELETE" })));
      setStays((list) => list?.filter((x) => x !== s) ?? null);
    });
  const shown = all ? stays : stays.slice(0, 6);

  return (
    <section className="card stack">
      <div className="head">
        <h2>
          Places you&apos;ve stayed <span className="hint tabnum">· {stays.length}</span>
        </h2>
        <p className="hint">From your calendar, email and photos. Mark the ones you loved and the ones that weren&apos;t for you: hotel picks follow them.</p>
      </div>
      <ul className="stays-list">
        {shown.map((s) => (
          <li key={s.ids[0]}>
            <div>
              <b>{s.name}</b>
              <span className="hint">{stayLine(s)}</span>
              <small className="hint">{s.sources.map((x) => SIGNAL_SOURCE_LABELS[x] ?? x).join(", ")}</small>
            </div>
            <div className="row">
              <button type="button" className="btn ghost sm" aria-pressed={s.liked === true} disabled={busy === s.ids[0]} onClick={() => rate(s, s.liked === true ? null : true)}>
                {s.liked === true ? "♥ Loved it" : "Loved it"}
              </button>
              <button type="button" className="btn ghost sm" aria-pressed={s.liked === false} disabled={busy === s.ids[0]} onClick={() => rate(s, s.liked === false ? null : false)}>
                Not for me
              </button>
              <button type="button" className="linkbtn danger" disabled={busy === s.ids[0]} onClick={() => remove(s)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      {stays.length > 6 && (
        <button type="button" className="linkbtn" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${stays.length}`}
        </button>
      )}
      {err && (
        <p className="status err" role="status">
          {err}
        </p>
      )}
    </section>
  );
}
