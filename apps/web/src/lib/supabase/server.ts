import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "../env";

/** Cookie-based client for web requests; queries run under the signed-in user's RLS. */
export function supabaseFromCookies(): SupabaseClient {
  const store = cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component; middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Token-based client for the mobile app; queries run under that user's RLS. */
export function supabaseFromToken(token: string): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let admin: SupabaseClient | null = null;
/** Service-role client. Server only; bypasses RLS. Use for caches, anonymized feedback, and approved picks. */
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
