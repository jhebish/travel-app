/** The bit of `fetch` this needs, so it runs on the site, in the app and in tests. */
type Get = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * The sign-in methods switched on in Supabase (Authentication → Sign In / Providers), read from
 * its public settings. The site and the app show "Continue with Google" only once Google is on
 * there, so turning it on (or off) needs no new release. Empty when it can't tell.
 */
export async function signInProviders(
  supabaseUrl: string,
  publicKey: string,
  get: Get = (url, init) => (globalThis as unknown as { fetch: Get }).fetch(url, init),
): Promise<Set<string>> {
  if (!supabaseUrl || !publicKey) return new Set();
  try {
    const res = await get(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: publicKey } });
    if (!res.ok) return new Set();
    const body = (await res.json()) as { external?: Record<string, unknown> } | null;
    return new Set(
      Object.entries(body?.external ?? {})
        .filter(([, on]) => on === true)
        .map(([name]) => name),
    );
  } catch {
    return new Set();
  }
}

/**
 * Why a "Continue with Google" round trip came back without a session, from the `error` and
 * `error_code` Supabase adds to the return link. "taken": a guest tried to add a Google account
 * that already belongs to someone (sign in to that account instead); "cancelled": they backed out.
 */
export function googleSignInError(error: string | null | undefined, errorCode: string | null | undefined): "taken" | "cancelled" | "failed" | null {
  if (!error && !errorCode) return null;
  if (errorCode === "identity_already_exists" || errorCode === "email_exists") return "taken";
  if (error === "access_denied") return "cancelled";
  return "failed";
}
