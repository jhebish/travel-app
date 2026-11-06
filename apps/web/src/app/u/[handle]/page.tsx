"use client";
import type { CommunityTrip, ProfileDTO } from "@travel/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, FollowButton, LevelBadge, PlaceChip, StatsRow, TripCard } from "@/components/community";
import { useMe } from "@/components/useMe";
import { api } from "@/lib/api";

export default function ProfilePage({ params }: { params: { handle: string } }) {
  const me = useMe();
  const [data, setData] = useState<{ profile: ProfileDTO; trips: CommunityTrip[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (me === undefined) return; // wait for the session so follow state is right
    api<{ profile: ProfileDTO; trips: CommunityTrip[] }>(`/api/community/u/${encodeURIComponent(params.handle)}`)
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, [params.handle, me]);

  if (err) return <div className="card empty"><b>{err}</b><Link href="/friends">Back to Friends</Link></div>;
  if (!data) return <div className="card"><p className="hint">Loading…</p></div>;
  const { profile: p, trips } = data;
  const countries = p.places ? [...new Set(p.places.map((x) => x.countryCode))] : [];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card stack">
        <div className="profilehead">
          <Avatar person={p} size={64} />
          <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
            <h1 className="profilename">{p.displayName}</h1>
            <span className="hint">
              @{p.handle}
              {p.homeCity ? ` · ${p.homeCity}` : ""} · <LevelBadge stats={p.stats} />
            </span>
            <span className="hint">
              <b className="tabnum">{p.followers}</b> followers · <b className="tabnum">{p.following}</b> following
              {p.followsMe && " · Follows you"}
            </span>
          </div>
          {p.isMe ? (
            <Link className="btn ghost sm" href="/profile">
              Edit
            </Link>
          ) : me?.user ? (
            <FollowButton handle={p.handle} initial={p.iFollow} onChange={(on) => setData((d) => (d ? { ...d, profile: { ...d.profile, iFollow: on, followers: d.profile.followers + (on ? 1 : -1) } } : d))} />
          ) : null}
        </div>
        {p.bio && <p>{p.bio}</p>}
        <StatsRow stats={p.stats} showNext={p.isMe} />
      </section>

      <section className="card stack">
        <h2>Where {p.isMe ? "you've" : `${p.displayName.split(" ")[0]} has`} been</h2>
        {p.places === null ? (
          <p className="hint">Follow {p.displayName.split(" ")[0]} to see the places they&apos;ve logged.</p>
        ) : p.places.length === 0 ? (
          <p className="hint">
            No places logged yet.{p.isMe && <> <Link href="/profile">Add the places you&apos;ve been</Link> to get better plans.</>}
          </p>
        ) : (
          <>
            <p className="hint">{countries.length} {countries.length === 1 ? "country" : "countries"}</p>
            <div className="chips">
              {p.places.map((x) => (
                <PlaceChip key={x.id} place={x} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="stack">
        <h2>Trips</h2>
        {trips.length ? (
          <div className="tgrid">
            {trips.map((t) => (
              <TripCard key={t.id} trip={t} showOwner={false} />
            ))}
          </div>
        ) : (
          <p className="hint">{p.isMe ? "None of your trips are shared yet. Open a trip, tap Share, and choose Followers or Everyone." : "No shared trips yet."}</p>
        )}
      </section>
    </div>
  );
}
