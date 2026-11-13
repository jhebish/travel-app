import { googleSignInError } from "@travel/core";
import { NextResponse } from "next/server";
import { redirectOnSite, safeNext } from "@/lib/safe-next";
import { supabaseFromCookies } from "@/lib/supabase/server";

/**
 * Where Google sends people back (via Supabase): exchanges the code for a session cookie.
 * `link=1` marks a guest adding Google to their guest account; if that Google account already
 * has a Pylos account, the sign-in page signs in to it instead (?google=1).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (code) {
    const { error } = await supabaseFromCookies().auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(redirectOnSite(next, url.origin));
  }
  const why = googleSignInError(url.searchParams.get("error"), url.searchParams.get("error_code"));
  const login = new URL("/login", url.origin);
  login.searchParams.set("next", next);
  if (why === "taken" && url.searchParams.get("link") === "1") login.searchParams.set("google", "1");
  else if (why !== "cancelled") login.searchParams.set("error", why ? "google" : "1");
  return NextResponse.redirect(login);
}
