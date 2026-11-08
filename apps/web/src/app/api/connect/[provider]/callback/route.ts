import { calendarSignals, dedupeSignals, guessKind, tripsFromSignals } from "@travel/core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth";
import { addPlacesBulk } from "@/lib/community";
import { OAUTH_COOKIE, facebookPlaces, facebookSignals, googleCalendarEvents, isProvider, type OAuthCookie } from "@/lib/connect";
import { readGmail } from "@/lib/gmail";
import { supabaseAdmin } from "@/lib/supabase/server";
import { signalRow } from "@/lib/taste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Back from Google (Calendar or Gmail) or Facebook: read once, keep only the places and trips we find, give the access back. */
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const url = new URL(req.url);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/profile?${q}#connect`, url.origin));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/connect", maxAge: 0 });
    return res;
  };
  const provider = params.provider;
  if (!isProvider(provider)) return back("connect_error=unknown");
  if (url.searchParams.get("error")) return back(`connect_error=denied&provider=${provider}`);

  let saved: OAuthCookie | null = null;
  try {
    saved = JSON.parse(cookies().get(OAUTH_COOKIE)?.value ?? "null") as OAuthCookie | null;
  } catch {
    saved = null;
  }
  const code = url.searchParams.get("code");
  const ctx = await getCtx(req);
  if (!saved || !code || saved.p !== provider || saved.s !== url.searchParams.get("state") || !ctx.user || ctx.user.id !== saved.u) {
    return back(`connect_error=expired&provider=${provider}`);
  }

  try {
    // Gmail's bookings are named by the model, and come deduped with their trips (lib/gmail.ts).
    const gmail = provider === "gmail" ? await readGmail(ctx, code, saved.v, url.origin) : null;
    const signals = gmail
      ? gmail.signals
      : dedupeSignals(
          provider === "google_calendar"
            ? calendarSignals(await googleCalendarEvents(code, saved.v, url.origin), "google_calendar")
            : facebookSignals(await facebookPlaces(code, url.origin), (n) => guessKind(n)),
        );
    let added = 0;
    const rows = signals.map((s) => signalRow(ctx.user!.id, s));
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await ctx.db
        .from("taste_signals")
        .upsert(rows.slice(i, i + 500), { onConflict: "user_id,source,ref", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      added += data?.length ?? 0;
    }
    // The cities and years they were in become past trips (ones already logged are skipped).
    const trips = gmail ? gmail.trips : tripsFromSignals(signals);
    const { added: tripsAdded } = trips.length ? await addPlacesBulk(ctx, trips).catch(() => ({ added: 0 })) : { added: 0 };
    await supabaseAdmin()
      .from("connections")
      .upsert({ user_id: ctx.user.id, provider, last_import_at: new Date().toISOString(), items_found: signals.length });
    return back(`connected=${provider}&found=${signals.length}&added=${added}&trips=${tripsAdded}`);
  } catch (e) {
    console.error(`connect ${provider} failed`, (e as Error).message);
    const why = (e as { code?: string }).code;
    if (why === "rate_limited" || why === "not_ready") return back(`connect_error=${why}&provider=${provider}`);
    if (why === "scope_denied") return back(`connect_error=denied&provider=${provider}`);
    // 23514: the database doesn't take this source yet (its migration hasn't been run). Nothing was kept.
    if (why === "23514") return back(`connect_error=not_ready&provider=${provider}`);
    return back(`connect_error=failed&provider=${provider}`);
  }
}
