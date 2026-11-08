import {
  GMAIL_TOOL,
  GmailBookingsSchema,
  MAX_GMAIL_MESSAGES,
  gmailForModel,
  gmailImport,
  gmailPrompt,
  gmailSearches,
  type GmailImport,
  type GmailMessageLike,
} from "@travel/core";
import type { Ctx } from "./auth";
import { callTool } from "./claude";
import { getMyProfile } from "./community";
import { GMAIL_SCOPE, redirectUri } from "./connect";
import { env } from "./env";
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase/server";
import { rateLimit } from "./tripAccess";

/**
 * Gmail: a one-time read of booking confirmations from about the last six years (hotels and
 * rentals, airlines and trains, Resy / OpenTable / Tock / SevenRooms, GetYourGuide / Viator).
 *
 * Privacy: the searches (packages/core/src/imports/gmail.ts) find likely confirmations; for each,
 * only the Subject and From headers, the date and Gmail's short preview are fetched, never the
 * body or attachments. Access is given back as soon as that's read. The model is sent the
 * sender's domain, the date, and the subject and preview with the greeting, email addresses, links,
 * phone and booking numbers taken out. Only the places and dates it finds are kept; no email is stored.
 */

/** The callback route has 60 seconds; reading Gmail stops by this point, leaving the rest for the model. */
const READ_MS = 20_000;
/** Model calls are over by this point, leaving time to save. */
const MODEL_MS = 52_000;
/** Emails per model call; the calls run in parallel. */
const BATCH = 50;
/** Gmail allows about 50 message reads a second per person. */
const PARALLEL = 6;
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

interface GMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

/** Exchange the code, read the confirmations' headers and previews, and give the access back. */
async function readConfirmations(code: string, verifier: string, origin: string, stopAt: number): Promise<GmailMessageLike[]> {
  const { id, secret } = env.googleOAuth();
  const tok = await getJson<{ access_token: string; scope?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri(origin, "gmail"), grant_type: "authorization_code", code_verifier: verifier }),
  });
  const auth = { headers: { Authorization: `Bearer ${tok.access_token}` } };
  try {
    // Google lets people untick a permission on its consent screen.
    if (tok.scope && !tok.scope.split(" ").includes(GMAIL_SCOPE)) throw new HttpError(403, "Gmail access wasn't given.", "scope_denied");

    // 1. Find likely confirmations: each kind of sender, each year back.
    const searches = gmailSearches();
    const found: string[][] = searches.map(() => []);
    let failed = 0;
    let firstError: unknown = null;
    await pool(
      searches.map((s, k) => ({ ...s, k })),
      PARALLEL,
      async (s) => {
        const q = new URLSearchParams({ q: s.q, maxResults: String(s.max), fields: "messages(id)" });
        try {
          const r = await getJson<{ messages?: { id: string }[] }>(`${GMAIL_API}/messages?${q}`, auth);
          found[s.k] = (r.messages ?? []).map((m) => m.id);
        } catch (e) {
          failed++;
          firstError ??= e;
        }
      },
    );
    // Every search failing (the Gmail API not switched on, say) is an error, not "nothing found".
    if (failed === searches.length) throw firstError;
    const ids = [...new Set(found.flat())].slice(0, MAX_GMAIL_MESSAGES);

    // 2. For each: who sent it, the subject, the date and Gmail's preview. Never the body.
    const messages: GmailMessageLike[] = [];
    const fields = "id,internalDate,snippet,payload/headers";
    await pool(ids, PARALLEL, async (mid) => {
      if (Date.now() > stopAt) return;
      const m = await getJson<GMessage>(`${GMAIL_API}/messages/${encodeURIComponent(mid)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&fields=${encodeURIComponent(fields)}`, auth).catch(
        () => null,
      );
      if (!m) return;
      const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      messages.push({ id: m.id, from: header("From"), subject: header("Subject"), snippet: m.snippet ?? "", sentAt: Number(m.internalDate ?? NaN) });
    });
    // Oldest first: a stable order for the model's numbering.
    return messages.sort((a, b) => (a.sentAt || 0) - (b.sentAt || 0) || a.id.localeCompare(b.id));
  } finally {
    // We only needed one read: give the access back.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.access_token)}`, { method: "POST" }).catch(() => {});
  }
}

/** The model names the bookings, a batch of emails per call, all at once. */
async function nameBookings(messages: GmailMessageLike[], deadline: number): Promise<unknown[]> {
  const emails = messages.map(gmailForModel);
  const batches = Array.from({ length: Math.ceil(emails.length / BATCH) }, (_, b) => b * BATCH);
  let failed = 0;
  let firstError: unknown = null;
  const out = await Promise.all(
    batches.map(async (first) => {
      try {
        const { input } = await callTool(gmailPrompt(emails.slice(first, first + BATCH), first), GMAIL_TOOL, 4000, { fast: true, deadline });
        const parsed = GmailBookingsSchema.safeParse(input);
        return parsed.success ? parsed.data.bookings : [];
      } catch (e) {
        failed++;
        firstError ??= e;
        return [];
      }
    }),
  );
  if (batches.length && failed === batches.length) throw firstError;
  return out.flat();
}

/**
 * Read Gmail once for the person in `ctx` (they just approved access and we have the code): the
 * places and trips found, ready to save. Counted against an hourly limit before anything is read.
 */
export async function readGmail(ctx: Ctx, code: string, verifier: string, origin: string): Promise<GmailImport> {
  const t0 = Date.now();
  await rateLimit(ctx, "gmail", 4, "You've read Gmail a few times this hour. Try again a little later.");
  // rateLimit lets people through when it can't record the event. For Gmail that means the database
  // doesn't know it yet (the community loop migration): nothing could be saved, so read nothing.
  const { count } = await supabaseAdmin()
    .from("rate_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user!.id)
    .eq("kind", "gmail")
    .gte("created_at", new Date(t0 - 300_000).toISOString());
  if (!count) throw new HttpError(503, "Gmail import isn't set up yet.", "not_ready");
  const messages = await readConfirmations(code, verifier, origin, t0 + READ_MS);
  if (!messages.length) return { signals: [], trips: [] };
  const [bookings, profile] = await Promise.all([nameBookings(messages, t0 + MODEL_MS), getMyProfile(ctx).catch(() => null)]);
  return gmailImport(bookings, messages, { home: profile?.homeCity || null });
}
