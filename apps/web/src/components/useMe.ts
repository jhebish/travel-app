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

/** Current user and role; starts a guest session if needed. undefined while loading. */
export function useMe(): Me | undefined {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    // People opening a shared trip link just read it; don't create a guest account for them.
    const publicPage = window.location.pathname.startsWith("/t/");
    const load = () => {
      (publicPage ? Promise.resolve() : ensureSession())
        .then(() => api<Me>("/api/me"))
        .then((m) => {
          if (alive) setMe(m);
        })
        .catch(() => {
          if (alive) setMe({ user: null, role: "traveler" });
        });
    };
    load();
    const { data } = supabaseBrowser().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") load();
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return me;
}

export const canCurate = (r?: Role) => r === "curator" || r === "admin";
export const canSubmitPicks = (r?: Role) => r === "local" || canCurate(r);
