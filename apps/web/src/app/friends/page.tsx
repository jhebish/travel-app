"use client";
import type { CommunityTrip, LeaderboardRow, MyCommunityProfile, PersonDTO } from "@travel/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { FollowButton, LevelBadge, PersonLine, TripCard } from "@/components/community";
import { useMe } from "@/components/useMe";
import { api, ApiError } from "@/lib/api";
import { planHref } from "@/lib/links";

type Tab = "friends" | "top" | "travelled" | "people";
const TABS: { id: Tab; label: string }[] = [
  { id: "friends", label: "Feed" },
  { id: "top", label: "Top trips" },
  { id: "travelled", label: "Most travelled" },
  { id: "people", label: "Find people" },
];

function Loading() {
  return <p className="hint">Loading…</p>;
}

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setData(null);
    setErr(null);
    api<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [path]);
  return { data, err };
}

function Friends({ joined }: { joined: boolean }) {
  const { data, err } = useLoad<{ trips: CommunityTrip[] }>("/api/community/feed");
  if (err) return <p className="status err">{err}</p>;
  if (!data) return <Loading />;
  if (!data.trips.length)
    return (
      <div className="empty">
        <b>No trips from friends yet</b>
        <span className="hint">Follow people to see the trips they share.</span>
        <Link href="/friends?tab=people">Find people</Link>
        {!joined && <Link href="/profile">Create your profile</Link>}
      </div>
    );
  return (
    <div className="tgrid">
      {data.trips.map((t) => (
        <TripCard key={t.id} trip={t} />
      ))}
    </div>
  );
}

function Top() {
  const params = useSearchParams();
  const router = useRouter();
  const city = params.get("city") ?? "";
  const [q, setQ] = useState(city);
  useEffect(() => setQ(city), [city]);
  const { data, err } = useLoad<{ trips: CommunityTrip[]; cities: { key: string; label: string; trips: number }[] }>(
    `/api/community/top${city ? `?city=${encodeURIComponent(city)}` : ""}`,
  );
  const go = (c: string) => router.replace(`/friends?tab=top${c ? `&city=${encodeURIComponent(c)}` : ""}`, { scroll: false });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <form
        className="searchrow"
        onSubmit={(e) => {
          e.preventDefault();
          go(q.trim());
        }}
      >
        <input type="search" placeholder="Search a city: Lisbon, Mexico City…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="City" />
        <button className="btn sm" type="submit">
          Search
        </button>
      </form>
      {data?.cities.length ? (
        <div className="chips" role="group" aria-label="Popular cities">
          <button type="button" className="chip" aria-pressed={!city} onClick={() => go("")}>
            All cities
          </button>
          {data.cities.slice(0, 12).map((c) => (
            <button key={c.key} type="button" className="chip" aria-pressed={city.toLowerCase() === c.label.toLowerCase() || city.toLowerCase() === c.key} onClick={() => go(c.label)}>
              {c.label} <small className="tabnum">{c.trips}</small>
            </button>
          ))}
        </div>
      ) : null}
      {err ? (
        <p className="status err">{err}</p>
      ) : !data ? (
        <Loading />
      ) : !data.trips.length ? (
        <div className="empty">
          <b>{city ? `No public trips for ${city} yet` : "No public trips yet"}</b>
          <span className="hint">Build one and set it to Everyone from its Share menu to be the first.</span>
          <Link href={city ? planHref(city) : "/plan"}>Plan a trip</Link>
        </div>
      ) : (
        <div className="tgrid">
          {data.trips.map((t, i) => (
            <TripCard key={t.id} trip={t} rank={i + 1} />
          ))}
        </div>
      )}
      <p className="hint">Ranked by likes from other travelers, then the planner&apos;s own rating. Only trips set to Everyone appear here.</p>
    </div>
  );
}

function Travelled({ joined }: { joined: boolean }) {
  const { data, err } = useLoad<{ rows: LeaderboardRow[] }>("/api/community/leaderboard");
  if (err) return <p className="status err">{err}</p>;
  if (!data) return <Loading />;
  const me = data.rows.find((r) => r.isMe);
  const ahead = me ? data.rows.find((r) => r.rank === me.rank - 1) ?? data.rows.filter((r) => r.rank < me.rank).at(-1) : undefined;
  return (
    <div className="stack" style={{ gap: 16 }}>
      {me && ahead && (
        <div className="callout">
          <b>
            {ahead.stats.countries - me.stats.countries + 1 > 0
              ? `${ahead.stats.countries - me.stats.countries + 1} more ${ahead.stats.countries - me.stats.countries + 1 === 1 ? "country" : "countries"} to pass ${ahead.person.displayName}.`
              : `A few more cities to pass ${ahead.person.displayName}.`}
          </b>{" "}
          <Link href="/profile">Log places you&apos;ve been</Link>
        </div>
      )}
      {me && me.rank === 1 && data.rows.length > 1 && <div className="callout"><b>You&apos;re the most travelled of your friends.</b></div>}
      {!data.rows.length || (data.rows.length === 1 && me) ? (
        <div className="empty">
          <b>{joined ? "Follow friends to see who's been where" : "Join to compare with friends"}</b>
          <span className="hint">Ranked by countries, then cities, from the places each person logs.</span>
          {joined ? <Link href="/friends?tab=people">Find people</Link> : <Link href="/profile">Create your profile</Link>}
        </div>
      ) : null}
      {data.rows.length > 0 && (
        <ol className="board">
          {data.rows.map((r) => (
            <li key={r.person.userId} className={r.isMe ? "me" : ""}>
              <span className="board-rank tabnum">{r.rank}</span>
              <PersonLine person={r.person} sub={<LevelBadge stats={r.stats} />} />
              <span className="board-stats">
                <b className="tabnum">{r.stats.countries}</b> countries
                <span className="hint tabnum"> · {r.stats.cities} cities</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function People() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data, err } = useLoad<{ people: (PersonDTO & { iFollow: boolean })[] }>(`/api/community/people?q=${encodeURIComponent(term)}`);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <input
        type="search"
        placeholder="Search by name or @handle"
        value={q}
        aria-label="Search people"
        onChange={(e) => {
          setQ(e.target.value);
          if (t.current) clearTimeout(t.current);
          const v = e.target.value;
          t.current = setTimeout(() => setTerm(v.replace(/^@/, "")), 300);
        }}
      />
      {err ? (
        <p className="status err">{err}</p>
      ) : !data ? (
        <Loading />
      ) : !data.people.length ? (
        <p className="hint">{term ? "No one matches that yet. Invite them to Pylos." : "Search for friends by name or handle."}</p>
      ) : (
        <>
          {!term && <span className="label">Follows you</span>}
          <ul className="people">
            {data.people.map((p) => (
              <li key={p.userId}>
                <PersonLine person={p} />
                <FollowButton handle={p.handle} initial={p.iFollow} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Community() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((x) => x.id === params.get("tab"))?.id ?? "friends") as Tab;
  const [mine, setMine] = useState<{ profile: MyCommunityProfile | null; canJoin: boolean } | null>(null);
  const [off, setOff] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.user) return;
    api<{ profile: MyCommunityProfile | null; canJoin: boolean }>("/api/community/profile")
      .then(setMine)
      .catch((e) => {
        if (e instanceof ApiError && e.code === "community_off") setOff(e.message);
      });
  }, [me?.user]);

  const joined = !!mine?.profile;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="pagehead">
        <div>
          <h1>Friends</h1>
          <p className="lede">Your friends&apos; trips, the best-rated plans in every city, and who&apos;s been where.</p>
        </div>
        {joined && (
          <Link className="btn ghost sm" href={`/u/${mine!.profile!.handle}`}>
            Your profile
          </Link>
        )}
      </div>
      {off && <p className="status err">{off}</p>}
      {mine && !joined && (
        <div className="callout row between">
          <span>
            <b>{mine.canJoin ? "Join the community" : "Sign in to join"}</b>
            <span className="hint"> Follow friends and share your trips. Log where you&apos;ve been to get better plans.</span>
          </span>
          <Link className="btn sm" href={mine.canJoin ? "/profile" : "/login?next=/profile"}>
            {mine.canJoin ? "Create profile" : "Sign in"}
          </Link>
        </div>
      )}
      <div className="seg wide" role="tablist" aria-label="Friends">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => router.replace(`/friends?tab=${x.id}`, { scroll: false })}>
            {x.label}
          </button>
        ))}
      </div>
      <section className="card">
        {tab === "friends" && <Friends joined={joined} />}
        {tab === "top" && <Top />}
        {tab === "travelled" && <Travelled joined={joined} />}
        {tab === "people" && <People />}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Community />
    </Suspense>
  );
}
