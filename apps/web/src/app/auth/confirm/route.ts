import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { redirectOnSite, safeNext } from "@/lib/safe-next";
import { supabaseFromCookies } from "@/lib/supabase/server";

/** The kinds of emailed sign-in links we send (see docs/email-templates). */
const TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "email_change"]);
/**
 * The phone app's own sign-in screen (Linking.createURL("auth-callback") in apps/mobile), which
 * finishes signing in itself. Only these exact links get the token: any other host or path, or an
 * Expo Go link to someone else's dev server, would hand the sign-in to whoever opens it.
 */
const APP_SCHEMES = new Set(["pylos:", "tripplanner:"]);
/** Expo Go while developing (exp://<dev machine>:8081/--/auth-callback). Never in production. */
const DEV_SCHEMES = new Set(["exp:", "exps:"]);

const parse = (raw: string | null) => {
  try {
    return raw ? new URL(raw) : null;
  } catch {
    return null;
  }
};

/** The app link to hand the token to, rebuilt from its parts (nothing else carried over), or null. */
function appCallback(back: URL | null): URL | null {
  if (!back || back.username || back.password) return null;
  if (APP_SCHEMES.has(back.protocol) && back.host === "auth-callback" && (back.pathname === "" || back.pathname === "/")) {
    return new URL(`${back.protocol}//auth-callback`);
  }
  if (process.env.NODE_ENV !== "production" && DEV_SCHEMES.has(back.protocol) && back.host && back.pathname.endsWith("/--/auth-callback")) {
    return new URL(`${back.protocol}//${back.host}${back.pathname}`);
  }
  return null;
}

/**
 * Target of the button in the sign-in email: /auth/confirm?token_hash=…&type=email&redirect_to=…
 * Unlike the older links, this works in any browser on any device, not just the one that asked.
 * `redirect_to` is where sign-in was requested from; only its `next` path is used here.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const raw = url.searchParams.get("redirect_to");
  const back = parse(raw);
  const valid = /^[\w-]{8,200}$/.test(tokenHash) && !!type && TYPES.has(type);

  // Asked from the phone app and opened on that phone: hand the token to the app.
  // Any other redirect_to (including app schemes that aren't the exact callback) signs in here.
  const app = valid ? appCallback(back) : null;
  if (app) {
    app.searchParams.set("token_hash", tokenHash);
    app.searchParams.set("type", type!);
    return NextResponse.redirect(app);
  }

  const next = safeNext(back?.searchParams.get("next") ?? url.searchParams.get("next"));
  if (valid) {
    const { error } = await supabaseFromCookies().auth.verifyOtp({ type: type!, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(redirectOnSite(next, url.origin));
    console.error("email link sign-in failed", error.code ?? error.status ?? "", error.message.slice(0, 80));
  }
  return NextResponse.redirect(new URL("/login?error=1", url.origin));
}
