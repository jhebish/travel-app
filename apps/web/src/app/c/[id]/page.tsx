"use client";
import type { CommunityTrip, Trip } from "@travel/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PersonLine } from "@/components/community";
import { readOnlyTrip } from "@/components/readOnlyTrip";
import { ResizableTrip } from "@/components/ResizableTrip";
import { useMe } from "@/components/useMe";
import { api } from "@/lib/api";

const ago = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function CommunityTripPage({ params }: { params: { id: string } }) {
  const me = useMe();
  const [t, setT] = useState<CommunityTrip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [likeErr, setLikeErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me === undefined) return;
    api<{ trip: CommunityTrip }>(`/api/community/trips/${params.id}`)
      .then((r) => setT(r.trip))
      .catch((e) => setErr((e as Error).message));
  }, [params.id, me]);

  const view: Trip | null = useMemo(() => {
    if (!t?.itinerary) return null;
    return readOnlyTrip({ destination: t.destination, title: t.title, itinerary: t.itinerary, party: t.party, createdAt: t.createdAt });
  }, [t]);

  async function like() {
    if (!t) return;
    setBusy(true);
    setLikeErr(null);
    try {
      const r = await api<{ liked: boolean; likes: number }>(`/api/community/trips/${t.id}/like`, { method: t.iLiked ? "DELETE" : "POST" });
      setT({ ...t, iLiked: r.liked, likes: r.likes });
    } catch (e) {
      setLikeErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div className="card empty"><b>{err}</b><Link href="/friends">Back to Friends</Link></div>;
  if (!t || !view) return <div className="card"><p className="hint">Loading…</p></div>;
  const mine = me?.user?.id === t.owner.userId;

  return (
    <>
      <div className="byline">
        <PersonLine person={t.owner} sub={ago(t.createdAt)} />
        <div className="row tight">
          {mine ? (
            <Link className="btn ghost sm" href={`/trips/${t.id}`}>
              Edit your trip
            </Link>
          ) : (
            <button type="button" className={`btn sm ${t.iLiked ? "ghost" : ""}`} aria-pressed={t.iLiked} disabled={busy || !me?.user} onClick={like}>
              <span aria-hidden="true">{t.iLiked ? "♥" : "♡"}</span> {t.iLiked ? "Liked" : "Like"} · <span className="tabnum">{t.likes}</span>
            </button>
          )}
        </div>
      </div>
      {likeErr && (
        <p className="status err" role="status">
          {likeErr} {/sign in/i.test(likeErr) && <Link href={`/login?next=/c/${t.id}`}>Sign in</Link>}
        </p>
      )}
      <ResizableTrip trip={view} />
      <aside className="cta">
        <h2>Want your own take on {t.destination.split(",")[0]}?</h2>
        <p className="lede">Pylos builds it around who&apos;s coming and what you&apos;re into.</p>
        <Link className="btn" href={`/plan?dest=${encodeURIComponent(t.destination)}&days=${t.days}`}>
          Plan a trip like this
        </Link>
      </aside>
    </>
  );
}
