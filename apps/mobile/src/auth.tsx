import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { supabase } from "./supabase";

const Ctx = createContext<{ session: Session | null; ready: boolean }>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    // Refresh tokens only while the app is in the foreground.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => {
      data.subscription.unsubscribe();
      sub.remove();
    };
  }, []);
  return <Ctx.Provider value={{ session, ready }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
