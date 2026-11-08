"use client";
import { friendPickLabel, type FriendPick } from "@travel/core";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "./useMe";

/** The small pieces of Friends who've been used on every page (the menu) and on trips. */

/** Sent when a question is asked, answered or declined, so the count in the menu catches up. */
export const ASKS_CHANGED = "pylos:asks";
export const asksChanged = () => typeof window !== "undefined" && window.dispatchEvent(new Event(ASKS_CHANGED));

export const LocalPill = () => <span className="pill local">Local</span>;

/** On a stop or hotel: whose pick it is ("Sara's pick", Local). */
export function FriendTag({ f }: { f: FriendPick }) {
  return (
    <span className="friend-pick">
      {friendPickLabel(f)}
      {f.local && <LocalPill />}
    </span>
  );
}

// One request for both menus (the header and the phone tab bar), at most every 10 seconds.
let countJob: { at: number; p: Promise<number> } | null = null;
function loadCount(fresh = false): Promise<number> {
  if (!fresh && countJob && Date.now() - countJob.at < 10_000) return countJob.p;
  const p = api<{ open: number }>("/api/asks/count")
    .then((r) => r.open)
    .catch(() => 0);
  countJob = { at: Date.now(), p };
  return p;
}

/** By Friends in the menu: questions waiting for your answer. */
export function AsksBadge() {
  const me = useMe();
  const path = usePathname();
  const [n, setN] = useState(0);
  const member = !!me?.user && !me.user.isGuest;
  useEffect(() => {
    if (!member) {
      setN(0);
      return;
    }
    let alive = true;
    const load = (fresh = false) => loadCount(fresh).then((v) => alive && setN(v));
    void load();
    const onChange = () => void load(true);
    window.addEventListener(ASKS_CHANGED, onChange);
    return () => {
      alive = false;
      window.removeEventListener(ASKS_CHANGED, onChange);
    };
  }, [member, path]);
  if (!n) return null;
  return (
    <span className="ask-count" aria-label={`${n} ${n === 1 ? "question" : "questions"} to answer`}>
      {n > 9 ? "9+" : n}
    </span>
  );
}
