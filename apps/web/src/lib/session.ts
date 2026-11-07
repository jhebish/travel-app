"use client";

let pending: Promise<void> | null = null;

/**
 * Make sure this browser has a session. Visitors who haven't signed in get a private
 * guest (anonymous) session, so trips, ratings and their source mix still save.
 * Shared across callers so a page load creates at most one guest.
 */
export function ensureSession(): Promise<void> {
  pending ??= (async () => {
    // Loaded on demand: pages that never need a session don't download the Supabase client.
    const { supabaseBrowser } = await import("./supabase/browser");
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getSession();
    if (data.session) return;
    const { error } = await sb.auth.signInAnonymously();
    if (error) console.error("Guest session failed", error.message);
  })().finally(() => {
    pending = null;
  });
  return pending;
}
