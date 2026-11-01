"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\s+/g, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.replace(/\s+/g, ""),
  );
  return client;
}
