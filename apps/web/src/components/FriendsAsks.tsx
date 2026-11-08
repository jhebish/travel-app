"use client";
import { ASK_MAX_PLACES, SIGNAL_KIND_LABELS, firstName, type AskDTO, type SignalKind } from "@travel/core";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AnswerPlaces } from "./Friends";
import { asksChanged } from "./FriendsBits";

/**
 * Questions friends asked you about a city (answer with a few words and up to 12 places, from
 * the ones you've logged there or typed by name, or decline), and the questions you asked.
 * On the Friends page; `focus` is an ask id from a link or notification (/friends?ask=<id>).
 */

type Chosen = { name: string; kind?: SignalKind | null; note: string; signalId?: string };
type MyPlace = { id: string; name: string; kind: SignalKind };

const ago = (iso: string) => {
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 864e5));
  return d === 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function AnswerForm({ ask, onDone, onCancel }: { ask: AskDTO; onDone: (a: AskDTO) => void; onCancel: () => void }) {
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
  const toggle = (p: MyPlace) =>
    setChosen((cs) => (has(p.name) ? cs.filter((c) => c.name.toLowerCase() !== p.name.toLowerCase()) : full ? cs : [...cs, { name: p.name, kind: p.kind, note: "", signalId: p.id }]));
  const addTyped = () => {
    const n = typed.trim().slice(0, 120);
    if (!n || has(n) || full) return;
    setChosen((cs) => [...cs, { name: n, note: "" }]);
    setTyped("");
  };
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !chosen.length) return setErr("Write a few words or add a place first.");
    setBusy(true);
    setErr(null);
    try {
      const { ask: a } = await api<{ ask: AskDTO }>(`/api/asks/${ask.id}`, { method: "POST", json: { action: "answer", answer: text.trim(), places: chosen } });
      asksChanged();
      onDone(a);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "We couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="answerbox stack" onSubmit={send}>
      <div className="field">
        <label className="label" htmlFor={`ans-${ask.id}`}>
          Your answer
        </label>
        <textarea id={`ans-${ask.id}`} maxLength={1500} rows={3} placeholder={`What should ${firstName(ask.person.displayName)} not miss in ${ask.city}?`} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">
          Places <small>(up to {ASK_MAX_PLACES})</small>
        </span>
        {mine === null ? (
          <p className="hint">Loading the places you&apos;ve logged…</p>
        ) : mine.length ? (
          <div className="chips" role="group" aria-label={`Places you've logged in ${ask.city}`}>
            {mine.map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={has(p.name)} disabled={!has(p.name) && full} onClick={() => toggle(p)}>
                {p.name} <small>{SIGNAL_KIND_LABELS[p.kind]}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="hint">You haven&apos;t logged places in {ask.city}. Type them in below.</p>
        )}
        <div className="searchrow">
          <input
            type="text"
            maxLength={120}
            placeholder="Add a place by name"
            aria-label="Add a place by name"
            value={typed}
            disabled={full}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTyped();
              }
            }}
          />
          <button type="button" className="btn ghost small" disabled={!typed.trim() || full} onClick={addTyped}>
            Add
          </button>
        </div>
        {chosen.length > 0 && (
          <ul className="chosen">
            {chosen.map((c) => (
              <li key={c.name}>
                <span>{c.name}</span>
                <button type="button" className="linkbtn" aria-label={`Remove ${c.name}`} onClick={() => setChosen((cs) => cs.filter((x) => x !== c))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="row tight">
        <button className="btn small" type="submit" disabled={busy}>
          {busy ? "Sending…" : `Send to ${firstName(ask.person.displayName)}`}
        </button>
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {err && (
        <p className="status err" role="status">
          {err}
        </p>
      )}
    </form>
  );
}

export function AsksInbox({ focus }: { focus?: string | null }) {
  const [data, setData] = useState<{ received: AskDTO[]; sent: AskDTO[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    api<{ received: AskDTO[]; sent: AskDTO[] }>("/api/asks")
      .then((d) => {
        setData(d);
        asksChanged();
      })
      .catch(() => setData(null));
  }, []);
  // A link or notification to one question: open it (if it's waiting for you) and bring it into view.
  useEffect(() => {
    if (!data || !focus || focused.current === focus) return;
    focused.current = focus;
    if (data.received.some((a) => a.id === focus && a.status === "open")) setOpen(focus);
    setTimeout(() => document.getElementById(`ask-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }, [data, focus]);
  if (!data || (!data.received.length && !data.sent.length)) return null;
  const waiting = data.received.filter((a) => a.status === "open").length;
  const put = (a: AskDTO) => setData((d) => (d ? { received: d.received.map((x) => (x.id === a.id ? a : x)), sent: d.sent } : d));
  async function decline(a: AskDTO) {
    setErr(null);
    try {
      await api(`/api/asks/${a.id}`, { method: "POST", json: { action: "decline" } });
      setData((d) => (d ? { ...d, received: d.received.filter((x) => x.id !== a.id) } : d));
      asksChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <section className="card stack asks">
      {data.received.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="head">
            <h2>Questions for you</h2>
            <span className="hint">{waiting ? `${waiting} waiting for your answer. Your picks go straight into their trip.` : "All answered. Thank you."}</span>
          </div>
          <ul className="asklist">
            {data.received.map((a) => (
              <li key={a.id} id={`ask-${a.id}`} className={focus === a.id ? "focus" : undefined}>
                <p className="ask-who">
                  <b>{a.person.displayName}</b> <span className="hint">asked about {a.city} · {ago(a.createdAt)}</span>
                </p>
                <p className="ask-q">{a.question}</p>
                {open === a.id ? (
                  <AnswerForm
                    ask={a}
                    onCancel={() => setOpen(null)}
                    onDone={(x) => {
                      put(x);
                      setOpen(null);
                    }}
                  />
                ) : a.status === "open" ? (
                  <div className="row tight">
                    <button type="button" className="btn small" onClick={() => setOpen(a.id)}>
                      Answer
                    </button>
                    <button type="button" className="linkbtn" onClick={() => decline(a)}>
                      Not this time
                    </button>
                  </div>
                ) : (
                  <div className="ask-answer">
                    <span className="hint">You answered</span>
                    {a.answer && <p className="answer-text">{a.answer}</p>}
                    <AnswerPlaces places={a.places} />
                    <button type="button" className="linkbtn" onClick={() => setOpen(a.id)}>
                      Edit your answer
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.sent.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          <h3>Your questions</h3>
          <ul className="asklist">
            {data.sent.map((a) => (
              <li key={a.id} id={`ask-${a.id}`} className={focus === a.id ? "focus" : undefined}>
                <p className="ask-who">
                  You asked <b>{a.person.displayName}</b> <span className="hint">about {a.city} · {ago(a.createdAt)}</span>
                  {a.isNew && <span className="pill new">New</span>}
                </p>
                {a.status === "answered" ? (
                  <>
                    {a.answer && <p className="answer-text">{a.answer}</p>}
                    <AnswerPlaces places={a.places} />
                    {a.tripId && <Link href={`/trips/${a.tripId}`}>Saved in your trip</Link>}
                  </>
                ) : a.status === "declined" ? (
                  <p className="hint">{firstName(a.person.displayName)} can&apos;t help with this one.</p>
                ) : (
                  <p className="hint">&ldquo;{a.question}&rdquo; No answer yet.</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {err && (
        <p className="status err" role="status">
          {err}
        </p>
      )}
    </section>
  );
}
