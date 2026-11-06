"use client";
import { SIGNAL_KIND_LABELS, SIGNAL_SOURCE_LABELS, dedupeSignals, parseImportFile, type PastTripInput, type SignalKind, type TasteSignal } from "@travel/core";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Provider = "google_calendar" | "facebook";
interface Status {
  providers: Record<Provider, { configured: boolean; lastImportAt: string | null; found: number }>;
}

interface Row {
  id: string;
  name: string;
  what: string;
  how?: string;
  provider?: Provider;
  file?: boolean;
  paste?: boolean;
}
const ROWS: Row[] = [
  {
    id: "google_calendar",
    name: "Google Calendar",
    what: "Past trips, hotel stays and dinner reservations, including the Resy and OpenTable bookings that land in your calendar.",
    provider: "google_calendar",
  },
  {
    id: "google_takeout",
    name: "Google Maps",
    what: "Your reviews, starred and saved places.",
    how: "Go to takeout.google.com, choose only “Maps (your places)” and “Saved”, export, then upload the .zip (or Reviews.json and Saved Places.json).",
    file: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    what: "Places from your posts.",
    how: "In Instagram: Accounts Center → Your information and permissions → Download your information → choose JSON. Upload the .zip.",
    file: true,
  },
  {
    id: "facebook",
    name: "Facebook",
    what: "Check-ins and places you were tagged at.",
    how: "In Facebook: Accounts Center → Download your information → choose JSON (posts and check-ins are enough). Upload the .zip.",
    provider: "facebook",
    file: true,
  },
  {
    id: "resy",
    name: "Resy and OpenTable",
    what: "They don't let other apps connect. Connect Google Calendar (your reservations show up there), or open your past reservations, select all, copy and paste them here.",
    paste: true,
  },
  { id: "swarm", name: "Swarm (Foursquare)", what: "Your check-in history.", how: "In Swarm: Settings → Privacy → Export data. Upload the .zip.", file: true },
  { id: "ics", name: "Apple or Outlook Calendar", what: "Export a calendar as an .ics file and upload it.", file: true },
  { id: "paste", name: "Beli, notes, anything", what: "Paste a list of places (a Beli list, trip notes, a group chat) and Pylos picks them out.", paste: true },
];

const ERRORS: Record<string, string> = {
  not_configured: "That connection isn't switched on yet. Upload a file or paste a list for now.",
  denied: "You didn't give access, so nothing was imported.",
  expired: "That took too long or came from another session. Try connecting again.",
  failed: "We couldn't read your account just now. Try again in a minute.",
  unknown: "Unknown connection.",
};
const MAX_ZIP = 400 * 1024 * 1024;

/** Read files on this device and return the places found. Zips are opened in the browser. */
async function readFiles(files: File[]): Promise<{ signals: TasteSignal[]; note: string | null }> {
  const found: TasteSignal[] = [];
  let unknown = 0;
  const take = (name: string, text: string) => {
    const r = parseImportFile(name, text);
    if (r.format === "unknown") unknown++;
    found.push(...r.signals);
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      if (f.size > MAX_ZIP) return { signals: [], note: `${f.name} is too big to open here. Unzip it and upload just the JSON or CSV files.` };
      const { unzip } = await import("fflate");
      const zipped = new Uint8Array(await f.arrayBuffer());
      const entries = await new Promise<Record<string, Uint8Array>>((res, rej) =>
        unzip(
          zipped,
          { filter: (e) => /\.(json|csv|ics)$/i.test(e.name) && e.originalSize < 40e6 && !/(^|\/)(media|photos|videos|messages|inbox)\//i.test(e.name) },
          (err, out) => (err ? rej(err) : res(out)),
        ),
      );
      const dec = new TextDecoder();
      for (const [name, data] of Object.entries(entries)) take(name, dec.decode(data));
    } else {
      take(f.name, await f.text());
    }
  }
  const signals = dedupeSignals(found);
  return { signals, note: !signals.length ? (unknown ? "We didn't find any places in that file. Check it's the right export (JSON, CSV or .ics)." : "No places found.") : null };
}

/** Trips (city + month) implied by imported places, to add to "Places you've been". */
function tripsFrom(signals: TasteSignal[]): PastTripInput[] {
  const by = new Map<string, PastTripInput>();
  for (const s of signals) {
    const city = s.kind === "city" ? s.name : s.city;
    if (!city || !s.countryCode || !s.date) continue;
    const year = Number(s.date.slice(0, 4));
    const month = Number(s.date.slice(5, 7)) || null;
    const key = `${city.toLowerCase()}|${year}`;
    if (!by.has(key)) by.set(key, { city: city.slice(0, 80), countryCode: s.countryCode, year, month, days: null, rating: null, highlights: "", tripId: null });
  }
  return [...by.values()].slice(0, 100);
}

/** Bring in where you've been: connect accounts, upload exports, or paste a list. */
export function ConnectCard({ onImported }: { onImported: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<{ source: string; signals: TasteSignal[] } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const reviewDlg = useRef<HTMLDialogElement>(null);
  const pasteDlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    api<Status>("/api/connect/status").then(setStatus).catch(() => {});
  }, []);

  // Back from Google or Facebook.
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("connect_error");
    if (!connected && !error) return;
    if (connected) {
      const found = Number(params.get("found") ?? 0);
      const name = connected === "google_calendar" ? "Google Calendar" : "Facebook";
      setMsg({ text: found ? `Read ${name} once and found ${found} places and trips. Access was handed straight back; we don't keep it.` : `Connected ${name}, but found no trips, stays or reservations.` });
      if (found) onImported();
    } else {
      setMsg({ text: ERRORS[error ?? ""] ?? ERRORS.failed!, err: true });
    }
    router.replace("/profile#connect", { scroll: false });
  }, [params, router, onImported]);

  useEffect(() => {
    if (review) reviewDlg.current?.showModal();
    else reviewDlg.current?.close();
  }, [review]);
  useEffect(() => {
    if (pasteOpen) pasteDlg.current?.showModal();
    else pasteDlg.current?.close();
  }, [pasteOpen]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy("file");
    setMsg(null);
    try {
      const { signals, note } = await readFiles([...list]);
      if (note) setMsg({ text: note, err: !signals.length });
      if (signals.length) setReview({ source: "your file", signals });
    } catch {
      setMsg({ text: "We couldn't open that file. If it's a .zip, try unzipping it and uploading the JSON files.", err: true });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function extract() {
    setBusy("paste");
    setMsg(null);
    try {
      const { signals } = await api<{ signals: TasteSignal[] }>("/api/taste/extract", { method: "POST", json: { text: pasteText } });
      setPasteOpen(false);
      if (signals.length) setReview({ source: "your list", signals });
      else setMsg({ text: "We couldn't find named places in that text.", err: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card stack connect" id="connect">
      <div className="head">
        <span className="eyebrow">Connect</span>
        <h2>Bring in where you&apos;ve been</h2>
        <p className="hint">
          The more Pylos knows about the hotels and restaurants you&apos;ve loved, the better it predicts the next ones. Files are read on your device; only the places we
          find are saved, and you can remove any of them.
        </p>
      </div>
      {msg && (
        <p className={`status${msg.err ? " err" : ""}`} role="status">
          {msg.text}
        </p>
      )}
      <ul className="connect-list">
        {ROWS.map((r) => {
          const st = r.provider ? status?.providers[r.provider] : undefined;
          const canOAuth = !!st?.configured;
          return (
            <li key={r.id} className="connect-row">
              <div className="connect-text">
                <b>{r.name}</b>
                <span className="hint">{r.what}</span>
                {st?.lastImportAt && (
                  <span className="hint">
                    Last read {new Date(st.lastImportAt).toLocaleDateString()} · {st.found} found
                  </span>
                )}
                {r.how && !canOAuth && (
                  <details className="how">
                    <summary>How to get the file</summary>
                    <p className="hint">{r.how}</p>
                  </details>
                )}
              </div>
              <div className="connect-actions">
                {canOAuth && (
                  <a className="btn sm" href={`/api/connect/${r.provider}/start`}>
                    {st?.lastImportAt ? "Read again" : "Connect"}
                  </a>
                )}
                {r.provider === "google_calendar" && !canOAuth && (
                  <span className="hint connect-soon">Direct connect coming soon. For now upload an .ics export below.</span>
                )}
                {r.file && !canOAuth && (
                  <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                    {busy === "file" ? "Reading…" : "Upload"}
                  </button>
                )}
                {r.paste && (
                  <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => setPasteOpen(true)}>
                    Paste
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <input ref={fileRef} type="file" multiple hidden accept=".json,.csv,.ics,.zip,application/json,text/csv,text/calendar,application/zip" onChange={(e) => onFiles(e.target.files)} />

      <dialog ref={pasteDlg} className="sheet" aria-labelledby="paste-title" onClose={() => setPasteOpen(false)}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void extract();
          }}
        >
          <div className="head">
            <h2 id="paste-title">Paste a list of places</h2>
            <p className="hint">Your Resy or OpenTable past reservations, a Beli list, trip notes… Pylos picks out the places and you choose what to keep.</p>
          </div>
          <textarea rows={9} maxLength={20000} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"Lilia · Brooklyn · Sat, Mar 8 · 2 guests\nVia Carota · New York · Jan 12\n…"} />
          <div className="row">
            <button className="btn" disabled={busy === "paste" || pasteText.trim().length < 3}>
              {busy === "paste" ? "Finding places…" : "Find places"}
            </button>
            <button type="button" className="linkbtn" onClick={() => setPasteOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={reviewDlg} className="sheet review" aria-labelledby="review-title" onClose={() => setReview(null)}>
        {review && (
          <ImportReview
            source={review.source}
            signals={review.signals}
            onDone={(text) => {
              setReview(null);
              setMsg({ text });
              onImported();
            }}
            onCancel={() => setReview(null)}
          />
        )}
      </dialog>
    </section>
  );
}

const KIND_ORDER: SignalKind[] = ["stay", "food", "drink", "coffee", "nightlife", "sight", "activity", "shop", "city"];

function ImportReview({ source, signals, onDone, onCancel }: { source: string; signals: TasteSignal[]; onDone: (text: string) => void; onCancel: () => void }) {
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [addTrips, setAddTrips] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trips = tripsFrom(signals);
  const groups = KIND_ORDER.map((k) => ({ kind: k, items: signals.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === k) })).filter((g) => g.items.length);
  const keep = signals.filter((_, i) => !skip.has(i));
  const toggle = (i: number) =>
    setSkip((x) => {
      const n = new Set(x);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      let added = 0;
      for (let i = 0; i < keep.length; i += 1000) {
        const r = await api<{ added: number }>("/api/taste/signals", { method: "POST", json: { signals: keep.slice(i, i + 1000) } });
        added += r.added;
      }
      let tripsAdded = 0;
      if (addTrips && trips.length) {
        const r = await api<{ added: number }>("/api/community/places/bulk", { method: "POST", json: { places: trips } }).catch(() => ({ added: 0 }));
        tripsAdded = r.added;
      }
      onDone(
        `Added ${added} ${added === 1 ? "place" : "places"}${keep.length - added ? ` (${keep.length - added} were already there)` : ""}${
          tripsAdded ? ` and ${tripsAdded} past ${tripsAdded === 1 ? "trip" : "trips"}` : ""
        }. Your taste is updating.`,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="head">
        <h2 id="review-title">
          {signals.length} {signals.length === 1 ? "place" : "places"} found in {source}
        </h2>
        <p className="hint">Untick anything that isn&apos;t right. Only what you keep is saved.</p>
      </div>
      <div className="review-list">
        {groups.map((g) => (
          <fieldset key={g.kind}>
            <legend className="label">
              {SIGNAL_KIND_LABELS[g.kind]} · {g.items.length}
            </legend>
            {g.items.slice(0, 120).map(({ s, i }) => (
              <label key={i} className="review-item">
                <input type="checkbox" checked={!skip.has(i)} onChange={() => toggle(i)} />
                <span>
                  {s.name}
                  <small>
                    {[s.city, s.date?.slice(0, 7), s.rating ? `★${s.rating}` : s.liked ? "♥" : "", s.source !== "paste" ? SIGNAL_SOURCE_LABELS[s.source] : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </label>
            ))}
            {g.items.length > 120 && <p className="hint">and {g.items.length - 120} more</p>}
          </fieldset>
        ))}
      </div>
      {trips.length > 0 && (
        <label className="switch">
          <div>
            <b>
              Also add {trips.length} {trips.length === 1 ? "trip" : "trips"} to Places you&apos;ve been
            </b>
            <span>Cities and months we could tell you visited. Trips you already logged are skipped.</span>
          </div>
          <input type="checkbox" checked={addTrips} onChange={(e) => setAddTrips(e.target.checked)} />
        </label>
      )}
      {err && (
        <p className="status err" role="status">
          {err}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn" disabled={saving || !keep.length} onClick={save}>
          {saving ? "Saving…" : `Keep ${keep.length}`}
        </button>
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
