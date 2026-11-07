"use client";

/**
 * "Someone signed in or out in this tab", without importing the Supabase client: pages that only
 * show things (Browse, shared trips, profiles) never load it, and the nav still hears about
 * sign-ins from the pages that do (see supabase/browser.ts).
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function authChanged(): void {
  listeners.forEach((l) => l());
}

export function onAuthChanged(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
