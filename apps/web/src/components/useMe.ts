"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type Role = "traveler" | "local" | "curator" | "admin";
export interface Me {
  user: { id: string; email?: string } | null;
  role: Role;
}

/** Current user and role; refreshes when the auth state changes. undefined while loading. */
export function useMe(): Me | undefined {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api<Me>("/api/me")
        .then((m) => {
          if (alive) setMe(m);
        })
        .catch(() => {
          if (alive) setMe({ user: null, role: "traveler" });
        });
    };
    load();
    const { data } = supabaseBrowser().auth.onAuthStateChange(() => {
      load();
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
