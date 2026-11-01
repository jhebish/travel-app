import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabase/server";

/** OAuth (Google) redirect target: exchanges the code for a session cookie. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  if (code) {
    const { error } = await supabaseFromCookies().auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=1", url.origin));
}
