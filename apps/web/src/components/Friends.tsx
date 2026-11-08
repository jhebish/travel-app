"use client";
import { askQuestion, cityKey, firstName, travelMonth, type AskDTO, type BeenFriend, type FriendsMe, type LikeTrip, type Trip } from "@travel/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PersonLine } from "./community";
import { LocalPill, asksChanged } from "./FriendsBits";
import { useMe } from "./useMe";

/**
 * Friends who've been: the friends to ask about a city, "From friends" on a trip, "Plan a trip
 * like this", and your own local cities and credits ("Sara's pick" and the menu count are in
 * FriendsBits.tsx). Data comes from /api/friends/* and /api/asks/* (lib/friends.ts, lib/asks.ts).
 */

// ---------------------------------------------------------------------------
// Ask a friend
// ---------------------------------------------------------------------------
/**
 * A short question, prefilled and editable. Not a <form>: it also sits inside the planner's form.
 */
function AskBox({ friend, city, month, tripId, onSent, onCancel }: { friend: BeenFriend["person"]; city: string; month?: number | null; tripId?: string | null; onSent: (a: AskDTO) => void; onCancel: () => void }) {
  const [q, setQ] = useState(() => askQuestion(city, month));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = city.split(",")[0]!.trim();
  async function send() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { ask } = await api<{ ask: AskDTO }>("/api/asks", { method: "POST", json: { to: friend.handle, city: label, question: q.trim(), tripId: tripId ?? null } });
      asksChanged();
      onSent(ask);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="askbox">
      <label className="label" htmlFor={`ask-${friend.userId}`}>
        Ask {firstName(friend.displayName)}
      </label>
      <textarea id={`ask-${friend.userId}`} maxLength={500} value={q} onChange={(e) => setQ(e.target.value)} rows={2} />
      <div className="row tight">
        <button type="button" className="btn small" disabled={busy || !q.trim()} onClick={send}>
          {busy ? "Sending…" : "Send"}
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
    </div>
  );
}

const beenLine = (f: BeenFriend) => {
  const dated = f.trips.map((t) => t.when).filter(Boolean) as string[];
  const n = f.trips.length;
  if (!n) return "Lives here";
  const times = n === 1 ? "Been once" : `Been ${n} times`;
  return dated.length ? `${times}, last in ${dated[0]}` : times;
};

/**
 * Friends who've been to a city (or live there): what they loved, a Local badge, and "Ask Sara".
 * Hidden when there's no one, for guests, and before the community-loop migration.
 */
export function FriendsWhoveBeen({ city, month, tripId, onAsked }: { city: string; month?: number | null; tripId?: string | null; onAsked?: (a: AskDTO) => void }) {
  const me = useMe();
  const member = !!me?.user && !me.user.isGuest;
  const [friends, setFriends] = useState<BeenFriend[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, true>>({});
  const term = city.trim();
  useEffect(() => {
    setOpen(null);
    if (!member || term.length < 3) {
      setFriends([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api<{ friends: BeenFriend[] }>(`/api/friends/been?city=${encodeURIComponent(term)}`)
        .then((r) => alive && setFriends(r.friends))
        .catch(() => alive && setFriends([]));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [member, term]);
  if (!friends.length) return null;
  const label = term.split(",")[0]!.trim();
  return (
    <section className="card friends-been" aria-label={`Friends who've been to ${label}`}>
      <div className="head">
        <h2>Friends who&apos;ve been</h2>
        <span className="hint">The places they loved in {label} go into your plan. Ask them for more.</span>
      </div>
      <ul className="been">
        {friends.map((f) => (
          <li key={f.person.userId}>
            <div className="been-top">
              <PersonLine person={f.person} sub={beenLine(f)} />
              <span className="row tight">
                {f.local && <LocalPill />}
                {sent[f.person.userId] ? (
                  <span className="hint">Asked</span>
                ) : (
                  <button type="button" className="btn ghost small" aria-expanded={open === f.person.userId} onClick={() => setOpen(open === f.person.userId ? null : f.person.userId)}>
                    Ask {firstName(f.person.displayName)}
                  </button>
                )}
              </span>
            </div>
            {f.loved.length > 0 && (
              <p className="been-loved">
                <small>Loved</small> {f.loved.map((p) => p.name).join(", ")}
              </p>
            )}
            {open === f.person.userId && (
              <AskBox
                friend={f.person}
                city={term}
                month={month}
                tripId={tripId}
                onCancel={() => setOpen(null)}
                onSent={(a) => {
                  setOpen(null);
                  setSent((s) => ({ ...s, [f.person.userId]: true }));
                  onAsked?.(a);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Plan a trip like this" (/plan?like=<past trip id>)
// ---------------------------------------------------------------------------
/** The past trip to plan one like, if the viewer may see it; `apply` fills in the destination once. */
export function useLikeTrip(apply: (destination: string) => void): LikeTrip | null {
  const params = useSearchParams();
  const id = params.get("like");
  const [like, setLike] = useState<LikeTrip | null>(null);
  const applied = useRef<string | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!id) {
      setLike(null);
      return;
    }
    let alive = true;
    api<{ like: LikeTrip }>(`/api/friends/like/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!alive) return;
        setLike(r.like);
        if (applied.current !== id) {
          applied.current = id;
          applyRef.current(r.like.destination);
        }
      })
      .catch(() => alive && setLike(null));
    return () => {
      alive = false;
    };
  }, [id]);
  return like;
}

/** Where to build: with ?like= while the destination is still that trip's city. */
export const buildPath = (like: LikeTrip | null, destination: string) =>
  like && cityKey(destination) === cityKey(like.destination) ? `/api/trips?like=${encodeURIComponent(like.id)}` : "/api/trips";

export function InspiredBy({ like, destination }: { like: LikeTrip | null; destination: string }) {
  if (!like || cityKey(destination) !== cityKey(like.destination)) return null;
  return <p className="inspired">Inspired by {like.mine ? "your" : `${firstName(like.ownerName)}'s`} {like.city} trip</p>;
}

// ---------------------------------------------------------------------------
// On a trip: "From friends", and friends to ask
// ---------------------------------------------------------------------------
export function AnswerPlaces({ places }: { places: AskDTO["places"] }) {
  if (!places.length) return null;
  return (
    <ul className="answer-places">
      {places.map((p) => (
        <li key={p.name}>
          <b>{p.name}</b>
          {p.note && <span className="hint"> {p.note}</span>}
          {p.mapsUrl && (
            <>
              {" "}
              <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer">
                Map
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function FromFriends({ asks }: { asks: AskDTO[] }) {
  if (!asks.length) return null;
  const answered = asks.filter((a) => a.status === "answered");
  return (
    <section className="card from-friends">
      <div className="head">
        <h2>From friends</h2>
        {answered.length > 0 && <span className="hint">Their places also go into your plan when you rebuild a day or swap a stop.</span>}
      </div>
      <ul className="answers">
        {asks.map((a) => (
          <li key={a.id}>
            <p className="answer-who">
              <b>{firstName(a.person.displayName)}</b> <span className="hint">on {a.city}</span>
            </p>
            {a.status === "answered" ? (
              <>
                {a.answer && <p className="answer-text">{a.answer}</p>}
                <AnswerPlaces places={a.places} />
              </>
            ) : (
              <p className="hint">You asked: &ldquo;{a.question}&rdquo; No answer yet.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Below a trip its owner is looking at. */
export function TripFriends({ trip }: { trip: Trip }) {
  const [asks, setAsks] = useState<AskDTO[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ asks: AskDTO[] }>(`/api/friends/trip/${trip.id}`)
      .then((r) => alive && setAsks(r.asks))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [trip.id, tick]);
  const it = trip.itinerary;
  const cities = it.mode === "multi" && it.route?.length ? it.route.slice(0, 4).map((l) => l.city) : [trip.request.destination || trip.destination];
  return (
    <>
      <FromFriends asks={asks} />
      {cities.map((c) => (
        <FriendsWhoveBeen key={c} city={c} month={travelMonth(trip.request)} tripId={trip.id} onAsked={() => setTick((n) => n + 1)} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Profiles: the setting, local cities and credits
// ---------------------------------------------------------------------------
// One request for both the switch and the card on the same page.
let meJob: { at: number; p: Promise<(FriendsMe & { off?: boolean }) | null> } | null = null;
const loadMe = (fresh = false) => {
  if (fresh || !meJob || Date.now() - meJob.at > 5_000) meJob = { at: Date.now(), p: api<FriendsMe & { off?: boolean }>("/api/friends/me").catch(() => null) };
  return meJob.p;
};

function useFriendsMe() {
  const [data, setData] = useState<(FriendsMe & { off?: boolean }) | null>(null);
  useEffect(() => {
    let alive = true;
    loadMe().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);
  return [data, setData] as const;
}

/** In the community profile settings: "Let friends' planners use places I loved". Saves straight away. */
export function PicksForFriendsSwitch() {
  const [data, setData] = useFriendsMe();
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  if (!data || data.off) return null;
  async function toggle(on: boolean) {
    setMsg(null);
    setData((d) => (d ? { ...d, picksForFriends: on } : d));
    try {
      const r = await api<{ picksForFriends: boolean }>("/api/friends/me", { method: "PUT", json: { picksForFriends: on } });
      setData((d) => (d ? { ...d, picksForFriends: r.picksForFriends } : d));
      void loadMe(true);
      setMsg({ text: "Saved." });
    } catch (e) {
      setData((d) => (d ? { ...d, picksForFriends: !on } : d));
      setMsg({ text: e instanceof ApiError ? e.message : "We couldn't save that. Try again.", err: true });
    }
  }
  return (
    <>
      <label className="switch" htmlFor="cp-picks">
        <div>
          <b>Let friends&apos; planners use places I loved</b>
          <span>Friends who follow you back can get your favourites in their plans, marked as your picks. Trips you made private are never used.</span>
        </div>
        <input id="cp-picks" type="checkbox" checked={data.picksForFriends} onChange={(e) => toggle(e.target.checked)} />
      </label>
      {msg && (
        <p className={`status${msg.err ? " err" : ""}`} role="status">
          {msg.text}
        </p>
      )}
    </>
  );
}

const cityList = (cities: { label: string }[]) => cities.map((c) => c.label).join(", ");

/** On your own profile: the cities you're a local for, and how your picks have helped friends. */
export function YourPicks() {
  const [data] = useFriendsMe();
  if (!data || data.off) return null;
  const { credits, localCities } = data;
  return (
    <section className="card stack your-picks">
      <div className="head">
        <h2>Your picks</h2>
        {localCities.length > 0 && (
          <p className="local-expert">
            <LocalPill /> Local expert: {cityList(localCities)}
          </p>
        )}
      </div>
      {credits.friends > 0 ? (
        <>
          <p>
            <b>
              Your picks helped {credits.friends} {credits.friends === 1 ? "friend" : "friends"}
            </b>
          </p>
          <ul className="notes">
            {credits.cities.map((c) => (
              <li key={c.key}>
                {c.label}: used {c.uses} {c.uses === 1 ? "time" : "times"}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="hint">When friends plan with places you loved, or you answer their questions, you&apos;ll see it here.</p>
      )}
      {!data.picksForFriends && <p className="note">Friends&apos; planners aren&apos;t using your places. Turn it back on in your community profile.</p>}
      <Link href="/friends" className="hint">
        Questions from friends →
      </Link>
    </section>
  );
}

/** On someone's profile: "Local expert: Lisbon". */
export function LocalExpertLine({ handle }: { handle: string }) {
  const [cities, setCities] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    api<{ localCities: { key: string; label: string }[] }>(`/api/friends/u/${encodeURIComponent(handle)}`)
      .then((r) => alive && setCities(r.localCities))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [handle]);
  if (!cities.length) return null;
  return (
    <p className="local-expert">
      <LocalPill /> Local expert: {cityList(cities)}
    </p>
  );
}
