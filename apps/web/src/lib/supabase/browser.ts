"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authChanged } from "../authEvents";

let client: SupabaseClient | null = null;

/**
 * The browser's Supabase client. It's large, so only sign-in, the profile and starting a guest
 * session load it (lib/session.ts imports it on demand); everything else uses our API routes.
 */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\s+/g, ""),
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.replace(/\s+/g, ""),
    );
    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") authChanged();
    });
  }
  return client;
}
