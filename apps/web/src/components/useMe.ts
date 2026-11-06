"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ensureSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type Role = "traveler" | "local" | "curator" | "admin";
export interface Me {
  user: { id: string; email?: string; isGuest: boolean } | null;
  role: Role;
}

/**
 * Browse (the home page), destination samples, shared and community trips, and public profiles
 * are for looking: visitors there don't get a guest account until they start planning.
 */
const isPublicPage = (path: string) => path === "/" || /^\/(t|d|c|u|browse)(\/|$)/.test(path);

// One lookup per page load, shared by every component that asks (the nav, the page, …).
let snapshot: Me | undefined;
let inflight: Promise<void> | null = null;
let listening = false;
const listeners = new Set<(m: Me) => void>();

function load(startGuest: boolean): Promise<void> {
  const run = (startGuest ? ensureSession() : Promise.resolve())
    .then(() => api<Me>("/api/me"))
    .catch((): Me => ({ user: null, role: "traveler" }))
    .then((m) => {
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
      listening = true;
      supabaseBrowser().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") void load(false);
      });
    }
    return () => {
      listeners.delete(setMe);
    };
  }, []);
  return me;
}

export const canCurate = (r?: Role) => r === "curator" || r === "admin";
export const canSubmitPicks = (r?: Role) => r === "local" || canCurate(r);
