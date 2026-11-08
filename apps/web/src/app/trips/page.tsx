"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RankNudge } from "@/components/RankNudge";
import { useMe } from "@/components/useMe";
import { api } from "@/lib/api";
import type { TripSummary } from "@/lib/trips";

type Filter = "all" | "saved" | "rated";

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function TripsPage() {
  const me = useMe();
  const [filter, setFilter] = useState<Filter>("all");
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [shared, setShared] = useState<(TripSummary & { owner: string })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const userId = me?.user?.id;
  useEffect(() => {
    if (!userId) return;
    // Switching filters quickly: only the latest request's answer is shown.
    let alive = true;
    setTrips(null);
    setError(null);
    api<{ trips: TripSummary[]; shared?: (TripSummary & { owner: string })[] }>(`/api/trips${filter === "all" ? "" : `?filter=${filter}`}`)
      .then((r) => {
        if (!alive) return;
        setTrips(r.trips);
        if (filter === "all") setShared(r.shared ?? []);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [userId, filter]);

  async function remove(id: string) {
    if (confirm !== id) return setConfirm(id);
    setConfirm(null);
    try {
      await api(`/api/trips/${id}`, { method: "DELETE" });
      setTrips((t) => t?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
    <RankNudge />
    <div className="card">
      <div className="head">
        <h1>My trips</h1>
        <p className="lede">Every trip you build is kept here, private to you. Save the keepers and rate them so future trips get better.</p>
      </div>
      {me?.user?.isGuest && (
        <p className="note">
          Your trips are saved in this browser. <Link href="/login?next=/trips">Sign in</Link> to keep them across devices.
        </p>
      )}
      {me && !me.user ? (
        <div className="empty">
          <b>Sign in to see your trips</b>
          <Link href="/login?next=/trips">Sign in</Link>
        </div>
      ) : (
        <>
          <div className="seg" role="tablist" aria-label="Filter trips">
            {(["all", "saved", "rated"] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "saved" ? "Saved" : "Rated"}
              </button>
            ))}
          </div>
          {error && <p className="status err">{error}</p>}
          {!trips ? (
            <span className="thinking">
              <span className="dot" />
              Loading your trips…
            </span>
          ) : !trips.length ? (
            <div className="empty">
              <b>{filter === "all" ? "No trips yet" : filter === "saved" ? "Nothing saved yet" : "Nothing rated yet"}</b>
              <span className="meta">{filter === "all" ? <>Build one on the <Link href="/plan">Plan</Link> page and it will appear here.</> : "Open a trip and use the stars or Save button."}</span>
            </div>
          ) : (
            <ul className="list">
              {trips.map((t) => (
                <li key={t.id}>
                  <div className="list-top">
                    <div className="list-title"><Link href={`/trips/${t.id}`}>{t.title}</Link></div>
                    {t.saved && <span className="tag">Saved</span>}
                  </div>
                  <div className="meta">
                    {t.days} {t.days === 1 ? "day" : "days"} in {t.destination}, planned {fmt(t.createdAt)}
                    {t.hasHotels ? ". Includes hotels" : ""}
                    {t.customMix ? ". Built with your source mix" : ""}
                  </div>
                  {t.rating > 0 && (
                    <div className="stars" aria-label={`Rated ${t.rating} of 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={n <= t.rating ? "on" : ""}>
                          ★
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="row">
                    <Link className="btn ghost small" href={`/plan?from=${t.id}`}>
                      Plan again
                    </Link>
                    <button className={`btn ghost small${confirm === t.id ? " danger" : ""}`} onClick={() => remove(t.id)}>
                      {confirm === t.id ? "Confirm remove" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
    {shared.length > 0 && (
      <section className="card stack">
        <div className="head">
          <span className="eyebrow">Planning together</span>
          <h2>Trips friends are planning with you</h2>
        </div>
        <ul className="list">
          {shared.map((t) => (
            <li key={t.id}>
              <div className="list-top">
                <div className="list-title">
                  <Link href={`/trips/${t.id}`}>{t.title}</Link>
                </div>
              </div>
              <div className="meta">
                {t.days} {t.days === 1 ? "day" : "days"} in {t.destination} · with {t.owner}
              </div>
            </li>
          ))}
        </ul>
      </section>
    )}
    </>
  );
}
