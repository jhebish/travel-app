import {
  ASKS_PER_DAY,
  askPlacesFrom,
  cityKey,
  firstName,
  isLoved,
  mapsSearchUrl,
  type AskCreate,
  type AskDTO,
  type AskPlace,
  type AskStatus,
  type SignalKind,
  type AskReplySchema,
} from "@travel/core";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import type { Ctx } from "./auth";
import { requireMember } from "./community";
import { FRIENDS_OFF, areFriends, isGuest, isMissing, profilesById, toPerson } from "./friends";
import { HttpError, isUuid } from "./http";
import { sendPush } from "./push";
import { supabaseAdmin } from "./supabase/server";
import { tripFor } from "./tripAccess";

/**
 * "Ask Sara": a question to a friend about a city, and their answer (a few words and up to 12
 * places), saved into the asker's trip. Only between friends (people who follow each other).
 * The server writes every row; each side reads only the asks they're part of.
 */

type DbError = { code?: string; message?: string } | null;
function check(error: DbError, what: string): void {
  if (!error) return;
  if (isMissing(error)) throw new HttpError(503, FRIENDS_OFF, "friends_off");
  console.error(`asks: ${what} failed`, error.code ?? "", (error.message ?? "").slice(0, 120).replace(/sb_[A-Za-z0-9_]+/g, "[key]"));
  throw new HttpError(500, "Something went wrong with that question. Try again.");
}

interface AskRow {
  id: string;
  asker_id: string;
  friend_id: string;
  city: string;
  city_key: string;
  trip_id: string | null;
  question: string;
  status: AskStatus;
  answer: string;
  answer_places: unknown;
  created_at: string;
  answered_at: string | null;
  asker_seen_at: string | null;
}
const ASK_COLS = "id, asker_id, friend_id, city, city_key, trip_id, question, status, answer, answer_places, created_at, answered_at, asker_seen_at";

const someone = (id: string) => ({ userId: id, handle: "", displayName: "A friend", homeCity: "" });

function toDTO(r: AskRow, other: string, people: Map<string, Parameters<typeof toPerson>[0]>, isNew = false): AskDTO {
  const p = people.get(other);
  return {
    id: r.id,
    city: r.city,
    question: r.question,
    status: r.status,
    answer: r.answer ?? "",
    places: askPlacesFrom(r.answer_places),
    tripId: r.trip_id,
    createdAt: r.created_at,
    answeredAt: r.answered_at,
    person: p ? toPerson(p) : someone(other),
    ...(isNew ? { isNew } : {}),
  };
}

/** Questions count against a daily limit, recorded before anything is sent (like lib/tripAccess.ts rateLimit, but per day). */
async function countAsk(userId: string) {
  const db = supabaseAdmin();
  const { error } = await db.from("rate_events").insert({ user_id: userId, kind: "ask" });
  if (error) {
    // No table, or the 'ask' kind isn't allowed yet (the migration hasn't run): don't block people.
    if (!["42P01", "23514"].includes(error.code ?? "")) console.error("ask rate event failed", error.code);
    return;
  }
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from("rate_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "ask").gte("created_at", since);
  if ((count ?? 0) > ASKS_PER_DAY) throw new HttpError(429, "You've asked a lot of questions today. Try again tomorrow.", "rate_limited");
}

/** Send a friend a question about a city. */
export async function createAsk(ctx: Ctx, input: AskCreate): Promise<AskDTO> {
  requireMember(ctx);
  const me = ctx.user.id;
  const db = supabaseAdmin();
  const [{ data: mine, error: e1 }, { data: friend, error: e2 }] = await Promise.all([
    db.from("community_profiles").select("user_id, handle, display_name, home_city").eq("user_id", me).maybeSingle(),
    db.from("community_profiles").select("user_id, handle, display_name, home_city").eq("handle", input.to).maybeSingle(),
  ]);
  check(e1 ?? e2, "people");
  if (!mine) throw new HttpError(400, "Create your community profile first.", "needs_profile");
  if (!friend) throw new HttpError(404, "We couldn't find that person.");
  if (friend.user_id === me) throw new HttpError(400, "You can't ask yourself.");
  if (!(await areFriends(me, friend.user_id as string))) throw new HttpError(403, "You can ask friends who follow you back.", "not_friends");
  if (input.tripId) await tripFor(ctx, input.tripId, "owner");
  const key = cityKey(input.city);
  if (!key) throw new HttpError(400, "Which city is it about?");
  const { data: open, error: e3 } = await db.from("asks").select("id").eq("asker_id", me).eq("friend_id", friend.user_id).eq("city_key", key).eq("status", "open").limit(1);
  check(e3, "open asks");
  if (open?.length) throw new HttpError(409, `You've already asked ${firstName(friend.display_name as string)} about ${input.city}. Their answer will show up here.`, "already_asked");
  await countAsk(me);
  const { data, error } = await db
    .from("asks")
    .insert({ asker_id: me, friend_id: friend.user_id, city: input.city, city_key: key, trip_id: input.tripId ?? null, question: input.question })
    .select(ASK_COLS)
    .single();
  check(error, "create");
  const row = data as AskRow;
  waitUntil(sendPush([row.friend_id], { title: `${firstName(mine.display_name as string)} asked about ${row.city}`, body: row.question, url: `/friends?ask=${row.id}` }));
  return toDTO(row, row.friend_id, new Map([[friend.user_id as string, friend as Parameters<typeof toPerson>[0]]]));
}

/** Questions for me (open ones first) and the ones I sent. Answers I hadn't seen are marked new, then seen. */
export async function listAsks(ctx: Ctx): Promise<{ received: AskDTO[]; sent: AskDTO[] }> {
  if (isGuest(ctx)) return { received: [], sent: [] };
  const me = ctx.user!.id;
  const db = supabaseAdmin();
  const [rec, sent] = await Promise.all([
    db.from("asks").select(ASK_COLS).eq("friend_id", me).neq("status", "declined").order("created_at", { ascending: false }).limit(50),
    db.from("asks").select(ASK_COLS).eq("asker_id", me).order("created_at", { ascending: false }).limit(50),
  ]);
  check(rec.error ?? sent.error, "list");
  const r = (rec.data ?? []) as AskRow[];
  const s = (sent.data ?? []) as AskRow[];
  const people = await profilesById([...r.map((x) => x.asker_id), ...s.map((x) => x.friend_id)]);
  const unseen = s.filter((x) => x.status === "answered" && !x.asker_seen_at).map((x) => x.id);
  if (unseen.length) {
    const { error } = await db.from("asks").update({ asker_seen_at: new Date().toISOString() }).in("id", unseen).eq("asker_id", me);
    if (error) console.error("asks: mark seen failed", error.code);
  }
  return {
    received: r.sort((a, b) => Number(b.status === "open") - Number(a.status === "open")).map((x) => toDTO(x, x.asker_id, people)),
    sent: s.map((x) => toDTO(x, x.friend_id, people, unseen.includes(x.id))),
  };
}

/** Questions waiting for my answer (the count by Friends in the menu). */
export async function openAskCount(ctx: Ctx): Promise<number> {
  if (isGuest(ctx)) return 0;
  const { count, error } = await supabaseAdmin().from("asks").select("id", { count: "exact", head: true }).eq("friend_id", ctx.user!.id).eq("status", "open");
  if (error) return 0;
  return count ?? 0;
}

async function askForFriend(ctx: Ctx, id: string): Promise<AskRow> {
  requireMember(ctx);
  if (!isUuid(id)) throw new HttpError(404, "That question isn't here anymore.");
  const { data, error } = await supabaseAdmin().from("asks").select(ASK_COLS).eq("id", id).eq("friend_id", ctx.user.id).maybeSingle();
  check(error, "ask");
  if (!data) throw new HttpError(404, "That question isn't here anymore.");
  return data as AskRow;
}

interface MyPlace {
  id: string;
  name: string;
  kind: SignalKind;
  url: string | null;
}

/** The places I've logged in a city (any trip of mine there, or tagged with the city), loved first. */
async function myPlacesIn(userId: string, city: string): Promise<MyPlace[]> {
  const key = cityKey(city);
  const db = supabaseAdmin();
  const [{ data: trips }, { data: sigs, error }] = await Promise.all([
    db.from("past_trips").select("id").eq("user_id", userId).eq("city_key", key).limit(200),
    db.from("taste_signals").select("id, past_trip_id, kind, name, city, url, liked, rating").eq("user_id", userId).order("created_at", { ascending: false }).limit(2000),
  ]);
  if (error) return [];
  const tripIds = new Set((trips ?? []).map((t) => t.id as string));
  const seen = new Set<string>();
  return (sigs ?? [])
    .filter((s) => s.kind !== "city" && ((s.past_trip_id && tripIds.has(s.past_trip_id as string)) || (s.city && cityKey(s.city as string) === key)))
    .sort((a, b) => Number(isLoved(b, null)) - Number(isLoved(a, null)))
    .filter((s) => {
      const k = (s.name as string).trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 40)
    .map((s) => ({ id: s.id as string, name: s.name as string, kind: s.kind as SignalKind, url: (s.url as string) ?? null }));
}

/** A question for me, with the places I've logged in its city to answer from. */
export async function askToAnswer(ctx: Ctx, id: string): Promise<{ ask: AskDTO; myPlaces: { id: string; name: string; kind: SignalKind }[] }> {
  const row = await askForFriend(ctx, id);
  const [people, mine] = await Promise.all([profilesById([row.asker_id]), myPlacesIn(row.friend_id, row.city)]);
  return { ask: toDTO(row, row.asker_id, people), myPlaces: mine.map(({ id: i, name, kind }) => ({ id: i, name, kind })) };
}

const isMapsUrl = (u: string | null) => !!u && /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(u);

/** Answer a question (a few words and up to 12 places), or decline it. */
export async function replyAsk(ctx: Ctx, id: string, reply: z.infer<typeof AskReplySchema>): Promise<AskDTO> {
  const row = await askForFriend(ctx, id);
  const me = ctx.user!.id;
  const db = supabaseAdmin();
  if (reply.action === "decline") {
    if (row.status === "answered") throw new HttpError(400, "You've already answered this one.");
    const { data, error } = await db.from("asks").update({ status: "declined" }).eq("id", id).eq("friend_id", me).select(ASK_COLS).single();
    check(error, "decline");
    return toDTO(data as AskRow, row.asker_id, await profilesById([row.asker_id]));
  }

  // Places chosen from my own logged places take their details from there; typed ones get a map search.
  const chosen = reply.places.filter((p) => p.signalId).map((p) => p.signalId!);
  const { data: sigs } = chosen.length
    ? await db.from("taste_signals").select("id, name, kind, url").eq("user_id", me).in("id", chosen)
    : { data: [] as { id: string; name: string; kind: SignalKind; url: string | null }[] };
  const byId = new Map((sigs ?? []).map((s) => [s.id as string, s]));
  const seen = new Set<string>();
  const places: AskPlace[] = [];
  for (const p of reply.places) {
    const sig = p.signalId ? byId.get(p.signalId) : undefined;
    const name = ((sig?.name as string | undefined) ?? p.name).trim().slice(0, 120);
    const k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    const kind = ((sig?.kind as string | undefined) ?? p.kind ?? null) as SignalKind | null;
    const url = (sig?.url as string | null | undefined) ?? null;
    places.push({ name, kind: kind === "city" ? null : kind, note: p.note.slice(0, 200), mapsUrl: isMapsUrl(url) ? url : mapsSearchUrl(name, row.city) });
  }
  if (!reply.answer && !places.length) throw new HttpError(400, "Write a few words or add a place first.");

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("asks")
    .update({ status: "answered", answer: reply.answer, answer_places: places.slice(0, 12), answered_at: now, asker_seen_at: null })
    .eq("id", id)
    .eq("friend_id", me)
    .select(ASK_COLS)
    .single();
  check(error, "answer");
  const saved = data as AskRow;
  const { error: cErr } = await db
    .from("pick_credits")
    .upsert({ owner_id: me, beneficiary_id: row.asker_id, kind: "ask", ref: id, city_key: row.city_key }, { onConflict: "owner_id,beneficiary_id,kind,ref", ignoreDuplicates: true });
  if (cErr) console.error("asks: credit failed", cErr.code);

  const people = await profilesById([me, row.asker_id]);
  const myName = firstName(people.get(me)?.display_name ?? "A friend");
  if (row.status !== "answered") {
    const body = reply.answer ? reply.answer.slice(0, 160) : `${places.length} ${places.length === 1 ? "place" : "places"} for ${row.city}.`;
    waitUntil(sendPush([row.asker_id], { title: `${myName} answered about ${row.city}`, body, url: row.trip_id ? `/trips/${row.trip_id}` : `/friends?ask=${row.id}` }));
  }
  return toDTO(saved, row.asker_id, people);
}

/**
 * "From friends" on a trip (its owner only): answers to questions asked for this trip, or about
 * its city with no trip, plus questions still waiting.
 */
export async function tripAnswers(ctx: Ctx, tripId: string): Promise<AskDTO[]> {
  const { row } = await tripFor(ctx, tripId, "owner");
  const it = row.itinerary;
  const keys = [...new Set([cityKey(row.destination), ...(it.mode === "multi" ? (it.route ?? []).map((l) => cityKey(l.city)) : [])].filter(Boolean))];
  const db = supabaseAdmin();
  const [forTrip, forCity] = await Promise.all([
    db.from("asks").select(ASK_COLS).eq("asker_id", row.user_id).eq("trip_id", row.id).neq("status", "declined").limit(50),
    keys.length
      ? db.from("asks").select(ASK_COLS).eq("asker_id", row.user_id).is("trip_id", null).in("city_key", keys).neq("status", "declined").limit(50)
      : Promise.resolve({ data: [] as AskRow[], error: null }),
  ]);
  if (isMissing(forTrip.error) || isMissing(forCity.error)) return [];
  check(forTrip.error ?? forCity.error, "trip answers");
  const all = [...((forTrip.data ?? []) as AskRow[]), ...((forCity.data ?? []) as AskRow[])].filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i);
  const people = await profilesById(all.map((r) => r.friend_id));
  return all
    .sort((a, b) => Number(b.status === "answered") - Number(a.status === "answered") || (b.answered_at ?? b.created_at).localeCompare(a.answered_at ?? a.created_at))
    .map((r) => toDTO(r, r.friend_id, people));
}
