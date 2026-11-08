"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { onAuthChanged } from "@/lib/authEvents";
import { ensureSession } from "@/lib/session";

export type Role = "traveler" | "local" | "curator" | "admin";
export interface Me {
  user: { id: string; email?: string; isGuest: boolean } | null;
  role: Role;
}

/**
 * Browse (the home page), destination samples, shared and community trips, past trip pages and
 * public profiles are for looking: visitors there don't get a guest account until they start planning.
 */
const isPublicPage = (path: string) => path === "/" || /^\/(t|d|c|u|p|browse)(\/|$)/.test(path);

// One lookup per page load, shared by every component that asks (the nav, the page, …).
let snapshot: Me | undefined;
let inflight: Promise<void> | null = null;
let listening = false;
const listeners = new Set<(m: Me) => void>();

const sameMe = (a: Me, b: Me) =>
  a.role === b.role && a.user?.id === b.user?.id && a.user?.isGuest === b.user?.isGuest && a.user?.email === b.user?.email;

function load(startGuest: boolean): Promise<void> {
  const run = (startGuest ? ensureSession() : Promise.resolve())
    .then(() => api<Me>("/api/me"))
    .catch((): Me => ({ user: null, role: "traveler" }))
    .then((m) => {
      // Supabase reports a sign-in each time the tab comes back into view. When nothing changed,
      // keep the same object: pages' effects that depend on it would otherwise re-run and
      // overwrite forms people are in the middle of editing.
      if (snapshot && sameMe(snapshot, m)) return;
      snapshot = m;
      listeners.forEach((l) => l(m));
    });
  inflight = run.finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Current user and role; starts a guest session on planning pages. undefined while loading. */
export function useMe(): Me | undefined {
  const [me, setMe] = useState<Me | undefined>(snapshot);
  useEffect(() => {
    listeners.add(setMe);
    const needGuest = !isPublicPage(window.location.pathname);
    if (inflight) {
      // Someone else is already asking; we'll hear the answer (and start a guest if this page needs one).
      if (needGuest) void inflight.then(() => (!snapshot?.user && !inflight ? load(true) : undefined));
    } else if (!snapshot || (!snapshot.user && needGuest)) {
      void load(needGuest);
    } else {
      setMe(snapshot);
    }
    if (!listening) {
      // Sign-ins and sign-outs in this tab (from pages that load the Supabase client) refresh the answer.
      listening = true;
      onAuthChanged(() => void load(false));
    }
    return () => {
      listeners.delete(setMe);
    };
  }, []);
  return me;
}

export const canCurate = (r?: Role) => r === "curator" || r === "admin";
export const canSubmitPicks = (r?: Role) => r === "local" || canCurate(r);
