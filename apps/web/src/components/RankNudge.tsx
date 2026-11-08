"use client";
import { localDate, nudgeDue, type RankNudge as Nudge, type RankNudges } from "@travel/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "./useMe";

const DISMISSED = "pylos.rankNudges.dismissed";

const dismissed = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

// One lookup a minute is plenty, however many pages show the banner.
let cache: { userId: string; at: number; data: Promise<RankNudges> } | null = null;
function load(userId: string): Promise<RankNudges> {
  if (!cache || cache.userId !== userId || Date.now() - cache.at > 60_000) {
    const data = api<RankNudges>("/api/rank/nudges").catch((): RankNudges => ({ recent: [], upcoming: [] }));
    cache = { userId, at: Date.now(), data };
  }
  return cache.data;
}

/**
 * "Back from Lisbon? Rank 5 spots in 60 seconds." For a week after one of your dated trips ends
 * (by this device's date), until you've ranked it or closed the banner.
 */
export function RankNudge() {
  const me = useMe();
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const userId = me?.user?.id;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void load(userId).then((r) => {
      if (!alive) return;
      const today = localDate();
      const gone = dismissed();
      setNudge(r.recent.find((n) => nudgeDue(n.overOn, today) && !gone.includes(n.key)) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [userId]);
  if (!nudge) return null;

  const close = () => {
    try {
      localStorage.setItem(DISMISSED, JSON.stringify([...dismissed(), nudge.key].slice(-50)));
    } catch {
      /* private mode: it just comes back next time */
    }
    setNudge(null);
  };
  return (
    <aside className="rank-nudge" aria-label="Rank your trip">
      <Link href={nudge.href} className="rank-nudge-link">
        <b>Back from {nudge.city}?</b> <span>Rank 5 spots in 60 seconds.</span>
      </Link>
      <button type="button" className="rank-nudge-x" aria-label={`Not now: hide the ${nudge.city} reminder`} onClick={close}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </aside>
  );
}
