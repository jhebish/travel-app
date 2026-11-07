import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { supabaseFromCookies } from "@/lib/supabase/server";

/** The kinds of emailed sign-in links we send (see docs/email-templates). */
const TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "email_change"]);
/** The phone app's own links: it finishes signing in itself. */
const APP_SCHEMES = new Set(["pylos:", "tripplanner:", "exp:", "exps:"]);

const parse = (raw: string | null) => {
  try {
    return raw ? new URL(raw) : null;
  } catch {
    return null;
  }
};

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
  if (valid && raw && back && APP_SCHEMES.has(back.protocol)) {
    const query = new URLSearchParams({ token_hash: tokenHash, type: type! }).toString();
    return NextResponse.redirect(`${raw}${raw.includes("?") ? "&" : "?"}${query}`);
  }

  const next = safeNext(back?.searchParams.get("next") ?? url.searchParams.get("next"));
  if (valid) {
    const { error } = await supabaseFromCookies().auth.verifyOtp({ type: type!, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    console.error("email link sign-in failed", error.code ?? error.status ?? "", error.message.slice(0, 80));
  }
  return NextResponse.redirect(new URL("/login?error=1", url.origin));
}
