"use client";
import { localDate, pairKey, tripLength, tripOverOn, type RankCard, type RankedGroup, type RankState, type Trip, type TripRankState } from "@travel/core";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PhotoCredit, photoSrc } from "./PlacePhoto";

/** One round: five answers, about a minute. */
const ROUND = 5;

type Pair = [RankCard, RankCard];
interface Err {
  text: string;
  code?: string;
}

/**
 * Loading, answering and skipping, for either ranking API (/api/rank or /api/trips/:id/rank).
 * Skipped pairs ("Can't decide") are kept for the session and sent along, so they don't come back.
 */
function useRanker<S extends { pair: Pair | null }>(path: string, query: Record<string, string>, extra: Record<string, unknown>) {
  const [state, setState] = useState<S | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedIn, setFinishedIn] = useState<number | null>(null);
  const skipped = useRef<string[]>([]);
  const answered = useRef(0);
  const qs = new URLSearchParams(query).toString();
  const extraKey = JSON.stringify(extra);

  useEffect(() => {
    let alive = true;
    setState(null);
    setErr(null);
    setDone(0);
    setStartedAt(null);
    setFinishedIn(null);
    skipped.current = [];
    answered.current = 0;
    api<S>(`${path}${qs ? `?${qs}` : ""}`)
      .then((s) => alive && setState(s))
      .catch((e) => alive && setErr({ text: (e as Error).message, code: e instanceof ApiError ? e.code : undefined }));
    return () => {
      alive = false;
    };
  }, [path, qs]);

  // The clock starts when the first pair is on screen.
  useEffect(() => {
    if (state?.pair && startedAt == null) setStartedAt(Date.now());
  }, [state, startedAt]);

  const send = useCallback(
    async (body: Record<string, unknown>, key: string, counts: boolean) => {
      setBusy(key);
      setErr(null);
      try {
        const s = await api<S>(path, { method: "POST", json: { ...JSON.parse(extraKey), ...body, skipped: skipped.current } });
        setState(s);
        if (counts) {
          answered.current += 1;
          setDone(answered.current);
          if (answered.current % ROUND === 0) {
            if (startedAt != null) setFinishedIn(Date.now() - startedAt);
            // A round's answers go into the taste profile now, not only next time the You page opens.
            void api("/api/taste/refresh", { method: "POST" }).catch(() => {});
          }
        }
      } catch (e) {
        setErr({ text: (e as Error).message, code: e instanceof ApiError ? e.code : undefined });
        // A place that's gone: show a fresh pair.
        if (e instanceof ApiError && e.code === "gone") api<S>(`${path}${qs ? `?${qs}` : ""}`).then(setState).catch(() => {});
      } finally {
        setBusy(null);
      }
    },
    [path, qs, extraKey, startedAt],
  );

  const pick = (winner: RankCard, loser: RankCard) => void send({ winner: winner.id, loser: loser.id }, winner.id, true);
  const skip = (a: RankCard, b: RankCard) => {
    skipped.current = [...skipped.current, pairKey(a.id, b.id)].slice(-60);
    void send({ skip: [a.id, b.id] }, "skip", false);
  };
  const more = () => {
    setFinishedIn(null);
    setStartedAt(Date.now());
  };
  const roundOver = finishedIn != null;
  return { state, err, busy, done, pick, skip, more, roundOver, finishedIn };
}

const secs = (ms: number) => Math.max(1, Math.round(ms / 1000));

/** The card's photo (decorative: the button says what it is). Gone quietly if it can't load. */
function CardImage({ card }: { card: RankCard }) {
  const [failed, setFailed] = useState(false);
  if (!card.photo || failed)
    return (
      <span className="rank-nophoto" aria-hidden="true">
        {card.name.slice(0, 1)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="rank-img"
      src={photoSrc(card.photo.name, 400)}
      srcSet={`${photoSrc(card.photo.name, 400)} 400w, ${photoSrc(card.photo.name, 800)} 800w`}
      sizes="(max-width: 720px) 45vw, 300px"
      alt=""
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Two cards side by side: tap the one you loved more. Arrow keys work too. */
export function PairPicker({
  pair,
  busy,
  done,
  onPick,
  onSkip,
}: {
  pair: Pair;
  busy: string | null;
  done: number;
  onPick: (winner: RankCard, loser: RankCard) => void;
  onSkip: (a: RankCard, b: RankCard) => void;
}) {
  const [a, b] = pair;
  const inRound = done % ROUND;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "ArrowLeft") onPick(a, b);
      else if (e.key === "ArrowRight") onPick(b, a);
      else if (e.key === "ArrowDown") onSkip(a, b);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a, b, busy, onPick, onSkip]);

  const side = (c: RankCard, other: RankCard, key: string) => (
    <div className={`rank-side${busy === c.id ? " won" : ""}`}>
      <button
        type="button"
        className="rank-card"
        disabled={!!busy}
        aria-keyshortcuts={key}
        aria-label={`I loved ${c.name} more`}
        onClick={() => onPick(c, other)}
      >
        <CardImage key={c.id} card={c} />
        <span className="rank-kind">{c.kind}</span>
        <b className="rank-name">{c.name}</b>
        {c.where && <span className="rank-where">{c.where}</span>}
      </button>
      {c.photo?.by && (
        <small className="rank-credit">
          <PhotoCredit photo={c.photo} />
        </small>
      )}
    </div>
  );

  return (
    <div className="rank-picker" aria-busy={!!busy}>
      <div className="rank-pair" role="group" aria-label="Which did you love more?">
        {side(a, b, "ArrowLeft")}
        <span className="rank-or" aria-hidden="true">
          or
        </span>
        {side(b, a, "ArrowRight")}
      </div>
      <div className="rank-foot">
        <button type="button" className="linkbtn" disabled={!!busy} aria-keyshortcuts="ArrowDown" onClick={() => onSkip(a, b)}>
          {busy === "skip" ? "Finding another pair…" : "Can't decide"}
        </button>
        <span className="rank-progress" role="img" aria-label={`${inRound} of ${ROUND} this round`}>
          {Array.from({ length: ROUND }, (_, i) => (
            <i key={i} className={i < inRound ? "on" : ""} />
          ))}
          <small>
            {inRound} of {ROUND}
          </small>
        </span>
      </div>
    </div>
  );
}

/** A ranking, best first, one list per kind. */
export function RankedList({ groups, title, hint }: { groups: RankedGroup[]; title: string; hint?: string }) {
  const shown = groups.filter((g) => g.items.length);
  if (!shown.length) return null;
  const single = shown.length === 1;
  return (
    <div className="rank-results">
      <div className="head">
        <h2>{title}</h2>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <div className="rank-groups">
        {shown.map((g) => (
          <div key={g.group} className="rank-group">
            {!single && <span className="label">{g.label}</span>}
            <ol className="rank-list">
              {g.items.map((x, i) => (
                <li key={x.id}>
                  <span className="rank-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <b>{x.name}</b>
                    {x.where && <span className="hint"> {x.where}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoundDone({ ms, onMore, canMore }: { ms: number; onMore: () => void; canMore: boolean }) {
  return (
    <div className="rank-done" role="status">
      <b>
        {ROUND} in {secs(ms)} seconds{secs(ms) <= 60 ? ". Nicely done." : "."}
      </b>
      <span>Every answer sharpens what Pylos picks for you next time.</span>
      {canMore && (
        <button type="button" className="btn ghost small" onClick={onMore}>
          Keep going
        </button>
      )}
    </div>
  );
}

const offText = (e: Err) =>
  e.code === "rank_off" ? "Ranking isn't switched on yet. Try again soon." : e.code === "unauthenticated" ? "Sign in to rank your places." : e.text;

// ---------------------------------------------------------------------------
// Your own places and trips (/rank)
// ---------------------------------------------------------------------------
export function OwnRanker({ kind, trip }: { kind: "trip" | "place"; trip: string | null }) {
  const query: Record<string, string> = { kind, ...(trip ? { trip } : {}) };
  const r = useRanker<RankState>("/api/rank", query, { kind, trip });
  const s = r.state;
  if (r.err && !s)
    return (
      <div className="card">
        <p className="status err">{offText(r.err)}</p>
      </div>
    );
  if (!s)
    return (
      <span className="thinking">
        <span className="dot" />
        Finding two to compare…
      </span>
    );
  const where = s.trip?.city;
  const title = kind === "trip" ? "Your top trips" : where ? `Your top places in ${where}` : "Your top places";
  const showPair = s.pair && !r.roundOver;
  return (
    <div className="stack rank">
      {showPair ? (
        <section className="card">
          <PairPicker pair={s.pair!} busy={r.busy} done={r.done} onPick={r.pick} onSkip={r.skip} />
        </section>
      ) : r.roundOver ? (
        <section className="card">
          <RoundDone ms={r.finishedIn!} onMore={r.more} canMore={!!s.pair} />
        </section>
      ) : (
        <section className="card empty">
          {s.items < 2 ? (
            <>
              <b>{kind === "trip" ? "Log at least two trips to rank them" : where ? `Tick a few more places you loved in ${where}` : "Log a few places you loved first"}</b>
              <span className="meta">
                On <Link href="/profile">your page</Link>, type a city and tick what you loved. Then come back and choose between them.
              </span>
            </>
          ) : (
            <>
              <b>That&apos;s everything for now</b>
              <span className="meta">{kind === "trip" ? "Log another trip and it joins the ranking." : "Log more places, or rank your trips against each other."}</span>
            </>
          )}
        </section>
      )}
      {r.err && s && <p className="status err">{offText(r.err)}</p>}
      {s.ranked.length > 0 && (
        <section className="card">
          <RankedList groups={s.ranked} title={title} hint={`From your ${s.votes} ${s.votes === 1 ? "answer" : "answers"}. Places are only compared with their own kind.`} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A Pylos trip's stops, after it (the trip page, and /rank?plan=<id>)
// ---------------------------------------------------------------------------
export function TripRanker({ tripId, inTrip = false }: { tripId: string; inTrip?: boolean }) {
  const r = useRanker<TripRankState>(`/api/trips/${tripId}/rank`, {}, {});
  const [open, setOpen] = useState(false);
  const s = r.state;
  if (r.err && !s) return inTrip ? null : <p className="status err">{offText(r.err)}</p>;
  if (!s)
    return inTrip ? null : (
      <span className="thinking">
        <span className="dot" />
        Loading the trip…
      </span>
    );
  if (!s.open) return inTrip ? null : <p className="note">You can rank this trip the morning after it ends{s.overOn ? `, on ${new Date(`${s.overOn}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}` : ""}.</p>;
  const favTitle = s.together ? (s.mineOnly ? "Your favourites so far" : "The group's favourites") : `Your favourites from ${s.city}`;
  const favHint = s.together ? (s.mineOnly ? "The group's favourites show once someone else ranks too." : `Ranked by ${s.voters} of the ${s.people} of you.`) : undefined;
  // On the trip page, someone who has ranked sees the favourites first and can carry on.
  const ranking = !inTrip || s.mine === 0 || open || r.done > 0;
  return (
    <div className="stack rank" style={{ gap: 18 }}>
      {ranking && s.pair && !r.roundOver && <PairPicker pair={s.pair} busy={r.busy} done={r.done} onPick={r.pick} onSkip={r.skip} />}
      {ranking && r.roundOver && <RoundDone ms={r.finishedIn!} onMore={r.more} canMore={!!s.pair} />}
      {ranking && !s.pair && <p className="hint">{s.mine ? "You've ranked everything on this trip." : "There's nothing to compare on this trip."}</p>}
      {r.err && <p className="status err">{offText(r.err)}</p>}
      {s.favourites.length > 0 ? (
        <RankedList groups={s.favourites} title={favTitle} hint={favHint} />
      ) : s.together && s.voters > 0 ? (
        <p className="hint">Once two of you have ranked, the group&apos;s favourites show here.</p>
      ) : null}
      {inTrip && !ranking && s.pair && (
        <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
          Keep ranking
        </button>
      )}
    </div>
  );
}

/** Mounted in the trip view: shows up the morning after a dated trip ends (on this device's clock). */
export function TripRank({ trip }: { trip: Trip }) {
  const overOn = tripOverOn(trip.request?.startDate, tripLength(trip));
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localDate()), []);
  if (!overOn || !today || today < overOn) return null;
  return (
    <section className="card rank-trip" id="rank" aria-labelledby="rank-trip-title">
      <div className="head">
        <span className="eyebrow">After the trip</span>
        <h2 id="rank-trip-title">Which did you love more?</h2>
        <p className="hint">Two at a time, a tap each. Your answers teach Pylos your taste for next time.</p>
      </div>
      <TripRanker tripId={trip.id} inTrip />
    </section>
  );
}

/** On your page: the way in to ranking your own places and trips. */
export function RankEntry({ places, trips }: { places: number; trips: number }) {
  if (places < 2 && trips < 2) return null;
  return (
    <section className="card rank-entry">
      <div className="head">
        <span className="eyebrow">Which did you love more?</span>
        <h2>Rank your favourites</h2>
        <p className="hint">Two at a time, a tap each. Pylos learns what you love most and plans around it.</p>
      </div>
      <div className="row">
        {places >= 2 && (
          <Link className="btn ghost small" href="/rank">
            Rank your places
          </Link>
        )}
        {trips >= 2 && (
          <Link className="btn ghost small" href="/rank?kind=trip">
            Rank your trips
          </Link>
        )}
      </div>
    </section>
  );
}
