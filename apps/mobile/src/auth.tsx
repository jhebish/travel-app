import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { supabase } from "./supabase";

const Ctx = createContext<{ session: Session | null; ready: boolean }>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Visitors who haven't signed in get a private guest session, so trips still save.
    supabase.auth.getSession().then(async ({ data }) => {
      let s = data.session;
      if (!s) {
        const { data: anon } = await supabase.auth.signInAnonymously();
        s = anon.session;
      }
      setSession(s);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // After signing out (or deleting the account), carry straight on as a fresh guest rather
      // than passing through "no session", which would send the app to the sign-in screen.
      if (event === "SIGNED_OUT") {
        supabase.auth.signInAnonymously().catch(() => setSession(null));
        return;
      }
      setSession(s);
    });
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
