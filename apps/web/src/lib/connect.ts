import { createHash, randomBytes } from "node:crypto";
import { countryCodeFor, type TasteSignal } from "@travel/core";
import { env } from "./env";

/**
 * Connected accounts. Each connection is a one-time read: we exchange the code for an access
 * token, read what we need, turn it into taste signals, and give the access back (revoke).
 * Tokens are never stored. Each provider lights up once its OAuth app keys are set in env.
 */
export const PROVIDERS = ["google_calendar", "facebook"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

export function configured(p: Provider): boolean {
  const k = p === "google_calendar" ? env.googleOAuth() : env.meta();
  return !!(k.id && k.secret);
}

export const OAUTH_COOKIE = "pylos_oauth";
export interface OAuthCookie {
  p: Provider;
  s: string; // state
  v: string; // PKCE verifier
  u: string; // user id that started it
}

const b64url = (b: Buffer) => b.toString("base64url");
const redirectUri = (origin: string, p: Provider) => `${origin}/api/connect/${p}/callback`;

/** Where to send the person to approve access, plus the state to remember in a cookie. */
export function authorizeUrl(p: Provider, origin: string, userId: string): { url: string; cookie: OAuthCookie } {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const cookie: OAuthCookie = { p, s: state, v: verifier, u: userId };
  if (p === "google_calendar") {
    const q = new URLSearchParams({
      client_id: env.googleOAuth().id,
      redirect_uri: redirectUri(origin, p),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      access_type: "online",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, cookie };
  }
  const q = new URLSearchParams({
    client_id: env.meta().id,
    redirect_uri: redirectUri(origin, p),
    response_type: "code",
    scope: "user_posts,user_tagged_places",
    state,
  });
  return { url: `https://www.facebook.com/v21.0/dialog/oauth?${q}`, cookie };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Google Calendar: past trips, hotel stays and dinner reservations (Resy, OpenTable…)
// ---------------------------------------------------------------------------
export interface CalendarEvent {
  id?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: string;
  end?: string;
}

interface GEvent {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

export async function googleCalendarEvents(code: string, verifier: string, origin: string): Promise<CalendarEvent[]> {
  const { id, secret } = env.googleOAuth();
  const tok = await getJson<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri(origin, "google_calendar"), grant_type: "authorization_code", code_verifier: verifier }),
  });
  const auth = { headers: { Authorization: `Bearer ${tok.access_token}` } };
  try {
    const list = await getJson<{ items?: { id: string; accessRole?: string; primary?: boolean }[] }>(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,accessRole,primary)",
      auth,
    );
    // Your own calendars; not holidays, birthdays or other people's shared ones.
    const cals = (list.items ?? [])
      .filter((c) => c.primary || c.accessRole === "owner")
      .filter((c) => !/#(holiday|contacts|weeknum)@|addressbook#contacts/.test(c.id))
      .slice(0, 8);
    const timeMin = new Date(Date.now() - 6 * 365 * 864e5).toISOString();
    const timeMax = new Date().toISOString();
    const out: CalendarEvent[] = [];
    for (const c of cals) {
      let pageToken: string | undefined;
      for (let page = 0; page < 4; page++) {
        const q = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          maxResults: "2500",
          fields: "nextPageToken,items(id,summary,location,description,start,end)",
          ...(pageToken ? { pageToken } : {}),
        });
        const r = await getJson<{ items?: GEvent[]; nextPageToken?: string }>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`,
          auth,
        );
        for (const e of r.items ?? []) {
          out.push({
            id: `${c.id.slice(0, 40)}:${e.id}`,
            summary: e.summary,
            location: e.location,
            // Only used to spot "Resy" / "OpenTable" style bookings; never stored.
            description: e.description?.slice(0, 600),
            start: e.start?.date ?? e.start?.dateTime,
            end: e.end?.date ?? e.end?.dateTime,
          });
        }
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
    }
    return out;
  } finally {
    // We only needed one read: give the access back.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.access_token)}`, { method: "POST" }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Facebook: check-ins and places you were tagged at
// ---------------------------------------------------------------------------
interface FbPlace {
  id?: string;
  name?: string;
  location?: { city?: string; country?: string; latitude?: number; longitude?: number };
}
interface FbItem {
  id: string;
  created_time?: string;
  place?: FbPlace;
}

export async function facebookPlaces(code: string, origin: string): Promise<{ place: FbPlace; date: string | null; ref: string }[]> {
  const { id, secret } = env.meta();
  const tok = await getJson<{ access_token: string }>(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: redirectUri(origin, "facebook"), code })}`,
  );
  const at = encodeURIComponent(tok.access_token);
  const fields = "place{id,name,location{city,country,latitude,longitude}},created_time";
  const out: { place: FbPlace; date: string | null; ref: string }[] = [];
  try {
    for (const edge of ["tagged_places", "posts"]) {
      let url: string | undefined = `https://graph.facebook.com/v21.0/me/${edge}?fields=${encodeURIComponent(fields)}&limit=100&access_token=${at}`;
      for (let page = 0; url && page < 10; page++) {
        type Page = { data?: FbItem[]; paging?: { next?: string } };
        const r: Page = await getJson<Page>(url).catch((): Page => ({}));
        for (const it of r.data ?? []) {
          if (it.place?.name) out.push({ place: it.place, date: it.created_time?.slice(0, 10) ?? null, ref: `${edge}:${it.id}` });
        }
        url = r.paging?.next;
      }
    }
    return out;
  } finally {
    await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${at}`, { method: "DELETE" }).catch(() => {});
  }
}

/** Facebook places as taste signals. `kindOf` guesses restaurant / hotel / sight from the name. */
export function facebookSignals(items: Awaited<ReturnType<typeof facebookPlaces>>, kindOf: (name: string) => TasteSignal["kind"]): TasteSignal[] {
  return items.map(({ place, date, ref }) => ({
    source: "facebook" as const,
    ref: place.id ? `place:${place.id}:${date ?? ""}` : ref,
    kind: kindOf(place.name!),
    name: place.name!.slice(0, 120),
    city: place.location?.city ?? null,
    countryCode: countryCodeFor(place.location?.country),
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    date,
  }));
}
