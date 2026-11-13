"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authChanged } from "../authEvents";

let client: SupabaseClient | null = null;

/** The project's address and public key, without whitespace (it can creep in when pasting them into Vercel). */
export const supabaseUrl = () => (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\s+/g, "");
export const supabasePublicKey = () => (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").replace(/\s+/g, "");

/**
 * The browser's Supabase client. It's large, so only sign-in, the profile and starting a guest
 * session load it (lib/session.ts imports it on demand); everything else uses our API routes.
 */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(supabaseUrl(), supabasePublicKey());
    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") authChanged();
    });
  }
  return client;
}
