import { googleSignInError } from "@travel/core";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

export type GoogleOutcome = "signed-in" | "cancelled" | "failed";

const exchanges = new Map<string, Promise<boolean>>();

/**
 * Trades the code from Google's round trip for a session, once per code: Android hands the return
 * link both to the Google window below and to the /auth-callback screen.
 */
export function finishSignIn(code: string): Promise<boolean> {
  let done = exchanges.get(code);
  if (!done) {
    done = supabase.auth.exchangeCodeForSession(code).then(({ error }) => !error);
    exchanges.set(code, done);
  }
  return done;
}

let busyUntil = 0;
/** While the Google window is open (and just after), /auth-callback leaves errors to the sign-in screen. */
export const googleInProgress = () => Date.now() < busyUntil;

/** One trip to Google in an in-app browser window, and back to pylos://auth-callback. */
async function roundTrip(addToGuest: boolean): Promise<{ outcome: GoogleOutcome; signInInstead?: boolean }> {
  const redirectTo = Linking.createURL("auth-callback");
  const options = { redirectTo, skipBrowserRedirect: true };
  const start = addToGuest
    ? await supabase.auth.linkIdentity({ provider: "google", options })
    : await supabase.auth.signInWithOAuth({ provider: "google", options });
  // Supabase won't add Google to a guest account unless manual linking is on: sign in instead.
  if (start.error || !start.data?.url) return { outcome: "failed", signInInstead: addToGuest };

  const back = await WebBrowser.openAuthSessionAsync(start.data.url, redirectTo);
  if (back.type !== "success") return { outcome: "cancelled" };
  const q = Linking.parse(back.url).queryParams ?? {};
  const one = (v: unknown) => (typeof v === "string" ? v : null);
  const code = one(q.code);
  if (code) return { outcome: (await finishSignIn(code)) ? "signed-in" : "failed" };
  const why = googleSignInError(one(q.error), one(q.error_code));
  return { outcome: why === "cancelled" ? "cancelled" : "failed", signInInstead: addToGuest && why === "taken" };
}

/**
 * "Continue with Google". A guest adds Google to their guest account so their trips come along,
 * as with email; if that Google account already has a Pylos account, this signs in to it instead.
 */
export async function continueWithGoogle(): Promise<GoogleOutcome> {
  busyUntil = Number.POSITIVE_INFINITY;
  try {
    const { data } = await supabase.auth.getUser();
    if (data.user?.is_anonymous) {
      const first = await roundTrip(true);
      if (!first.signInInstead) return first.outcome;
    }
    return (await roundTrip(false)).outcome;
  } finally {
    busyUntil = Date.now() + 5000;
  }
}
