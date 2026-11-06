import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth";
import { OAUTH_COOKIE, authorizeUrl, configured, isProvider } from "@/lib/connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send the person to Google or Facebook to approve a one-time read. */
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/profile?${q}#connect`, origin));
  if (!isProvider(params.provider)) return back("connect_error=unknown");
  if (!configured(params.provider)) return back(`connect_error=not_configured&provider=${params.provider}`);
  const ctx = await getCtx(req);
  if (!ctx.user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/profile#connect")}`, origin));
  const { url, cookie } = authorizeUrl(params.provider, origin, ctx.user.id);
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify(cookie), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/connect", maxAge: 600 });
  return res;
}
