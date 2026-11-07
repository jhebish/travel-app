import { randomBytes } from "node:crypto";
import type { PersonDTO, Together, TripPerson, TripSummary } from "@travel/core";
import type { Ctx } from "./auth";
import { HttpError } from "./http";
import type { Companion, EditPeople } from "./pipeline";
import { supabaseAdmin } from "./supabase/server";
import { toSummary, type TripRow } from "./trips";

/**
 * Planning together: a trip's owner plus friends they added (or who joined with an invite link).
 * Everyone can see the plan, say which stops they're in for, swap stops and rebuild days; the
 * planner blends everyone's taste. Only the owner can share it publicly, invite people (by adding
 * them or with a link), remove them, or delete it.
 */

const INVITE_DAYS = 14;
const MAX_PEOPLE = 8;

async function namesFor(userIds: string[]): Promise<Map<string, { name: string; handle: string | null }>> {
  const out = new Map<string, { name: string; handle: string | null }>();
  if (!userIds.length) return out;
  const { data } = await supabaseAdmin().from("community_profiles").select("user_id, handle, display_name").in("user_id", userIds);
  for (const r of data ?? []) out.set(r.user_id as string, { name: r.display_name as string, handle: r.handle as string });
  return out;
}

export async function memberIds(tripId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from("trip_members").select("user_id").eq("trip_id", tripId).order("created_at");
  if (error) return []; // not set up yet
  return (data ?? []).map((r) => r.user_id as string);
}

/** Everyone on the trip and who's in for which stop (only for the place still in that slot). */
export async function loadTogether(row: TripRow, me: string): Promise<Together> {
  const members = await memberIds(row.id);
  const ids = [row.user_id, ...members];
  const [names, { data: reacts }] = await Promise.all([
    namesFor(ids),
    supabaseAdmin().from("trip_reactions").select("user_id, item, place_name, value").eq("trip_id", row.id),
  ]);
  const people: TripPerson[] = ids.map((id) => ({
    userId: id,
    name: names.get(id)?.name ?? (id === row.user_id ? "Trip owner" : "Friend"),
    handle: names.get(id)?.handle ?? null,
    owner: id === row.user_id,
    me: id === me,
  }));
  const reactions: Together["reactions"] = {};
  const placeAt = (item: string) => {
    const [a, b] = item.split("-");
    return a === "h" ? row.itinerary.hotels?.[Number(b)]?.name : row.itinerary.days[Number(a)]?.stops[Number(b)]?.name;
  };
  for (const r of reacts ?? []) {
    if (!ids.includes(r.user_id as string) || placeAt(r.item as string) !== r.place_name) continue;
    (reactions[r.item as string] ??= {})[r.user_id as string] = r.value as 1 | -1;
  }
  // The owner's own thumbs count too.
  for (const [item, v] of Object.entries(row.votes ?? {})) {
    if (members.length && placeAt(item)) (reactions[item] ??= {})[row.user_id] ??= v as 1 | -1;
  }
  return { people, reactions };
}

/** For edits: the other people's tastes to blend in, and the stops someone is in for. */
export async function editPeople(row: TripRow): Promise<EditPeople> {
  const members = await memberIds(row.id);
  if (!members.length) return { companions: [], liked: new Map() };
  const t = await loadTogether(row, row.user_id);
  const companions: Companion[] = t.people.filter((p) => !p.owner).map((p) => ({ userId: p.userId, label: p.name }));
  const liked = new Map<string, string>();
  for (const [item, by] of Object.entries(t.reactions)) {
    if (item.startsWith("h-") || !Object.values(by).includes(1)) continue;
    const [d, i] = item.split("-").map(Number) as [number, number];
    const name = row.itinerary.days[d]?.stops[i]?.name;
    if (name) liked.set(item, name);
  }
  return { companions, liked };
}

/** "I'm in" (1), "pass" (-1) or clear (0) for one stop or hotel. */
export async function react(ctx: Ctx, row: TripRow, item: string, value: 1 | -1 | 0) {
  const [a, b] = item.split("-");
  const place = a === "h" ? row.itinerary.hotels?.[Number(b)] : row.itinerary.days[Number(a)]?.stops[Number(b)];
  if (!place) throw new HttpError(404, "That stop isn't in this trip anymore. Reload and try again.");
  const db = supabaseAdmin();
  const key = { trip_id: row.id, user_id: ctx.user!.id, item };
  const { error } = value
    ? await db.from("trip_reactions").upsert({ ...key, place_name: place.name, value, updated_at: new Date().toISOString() })
    : await db.from("trip_reactions").delete().match(key);
  if (error) throw error;
}

async function isMutual(a: string, b: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("follows")
    .select("follower_id")
    .or(`and(follower_id.eq.${a},followee_id.eq.${b}),and(follower_id.eq.${b},followee_id.eq.${a})`);
  return (data ?? []).length === 2;
}

/** Friends you can add straight to a trip: people you follow who follow you back. */
export async function mutualFriends(ctx: Ctx): Promise<PersonDTO[]> {
  if (!ctx.user) return [];
  const db = supabaseAdmin();
  const [{ data: out }, { data: inc }] = await Promise.all([
    db.from("follows").select("followee_id").eq("follower_id", ctx.user.id).limit(1000),
    db.from("follows").select("follower_id").eq("followee_id", ctx.user.id).limit(1000),
  ]);
  const followsMe = new Set((inc ?? []).map((r) => r.follower_id as string));
  const ids = (out ?? []).map((r) => r.followee_id as string).filter((id) => followsMe.has(id)).slice(0, 200);
  if (!ids.length) return [];
  const { data } = await db.from("community_profiles").select("user_id, handle, display_name, home_city").in("user_id", ids);
  return (data ?? [])
    .map((r) => ({ userId: r.user_id as string, handle: r.handle as string, displayName: r.display_name as string, homeCity: (r.home_city as string) ?? "" }))
    .sort((x, y) => x.displayName.localeCompare(y.displayName));
}

async function addMemberRow(tripId: string, userId: string, by: string) {
  const members = await memberIds(tripId);
  if (members.includes(userId)) return;
  if (members.length + 1 >= MAX_PEOPLE) throw new HttpError(400, `A trip can have up to ${MAX_PEOPLE} people planning it.`, "too_many");
  const { error } = await supabaseAdmin().from("trip_members").insert({ trip_id: tripId, user_id: userId, added_by: by });
  if (error && error.code !== "23505") throw error;
}

/** The owner adds a friend directly (they must follow each other). */
export async function addFriend(ctx: Ctx, row: TripRow, handle: string) {
  const { data: p } = await supabaseAdmin().from("community_profiles").select("user_id").eq("handle", handle.toLowerCase()).maybeSingle();
  if (!p) throw new HttpError(404, "No one with that handle.");
  const uid = p.user_id as string;
  if (uid === row.user_id) return;
  if (!(await isMutual(ctx.user!.id, uid))) throw new HttpError(403, "You can add friends who follow you back. Send them an invite link instead.", "not_mutual");
  await addMemberRow(row.id, uid, ctx.user!.id);
}

/**
 * Add the friends a new trip was planned with (from companionsFromHandles, so already checked as
 * mutual follows) to it, in one insert. The trip was just built and saved, so a failure here is
 * logged rather than failing the build.
 */
export async function addFriendsOnCreate(ctx: Ctx, tripId: string, companions: Companion[]) {
  const me = ctx.user!.id;
  const ids = [...new Set(companions.map((c) => c.userId))].filter((id) => id !== me).slice(0, MAX_PEOPLE - 1);
  if (!ids.length) return;
  const { error } = await supabaseAdmin()
    .from("trip_members")
    .insert(ids.map((user_id) => ({ trip_id: tripId, user_id, added_by: me })));
  if (error && error.code !== "23505") console.error("adding friends to a new trip failed", error.code ?? "", (error.message ?? "").slice(0, 120));
}

/** Their tastes, to plan a new trip around everyone (mutual follows only). */
export async function companionsFromHandles(ctx: Ctx, handles: string[]): Promise<Companion[]> {
  if (!ctx.user || !handles.length) return [];
  const me = ctx.user.id;
  const { data } = await supabaseAdmin().from("community_profiles").select("user_id, display_name, handle").in("handle", handles.slice(0, MAX_PEOPLE - 1).map((h) => h.toLowerCase()));
  const rows = data ?? [];
  const mutual = await Promise.all(rows.map((r) => isMutual(me, r.user_id as string)));
  return rows.filter((_, i) => mutual[i]).map((r) => ({ userId: r.user_id as string, label: r.display_name as string }));
}

/**
 * The owner removes someone, or someone leaves. Their invite links go first, so a failure leaves
 * them on the trip (and the owner can try again) rather than able to walk straight back in. When
 * the owner removes someone, every link to the trip goes, because the person removed may hold one
 * of the owner's own; the owner makes a new link for anyone still to join. Someone leaving takes
 * only the links they made.
 */
export async function removePerson(ctx: Ctx, row: TripRow, userId: string) {
  const me = ctx.user!.id;
  if (me !== row.user_id && me !== userId) throw new HttpError(403, "Only the trip's owner can remove other people.");
  if (userId === row.user_id) throw new HttpError(400, "The trip's organizer can't be removed from it.");
  const db = supabaseAdmin();
  const links = db.from("trip_invites").delete().eq("trip_id", row.id);
  const { error: linkErr } = me === row.user_id ? await links : await links.eq("created_by", userId);
  if (linkErr) throw linkErr;
  const { error } = await db.from("trip_members").delete().eq("trip_id", row.id).eq("user_id", userId);
  if (error) throw error;
  await db.from("trip_reactions").delete().eq("trip_id", row.id).eq("user_id", userId);
}

/** A link anyone can open to join the planning (valid for two weeks). */
export async function createInvite(ctx: Ctx, row: TripRow): Promise<string> {
  const token = randomBytes(18).toString("base64url");
  const { error } = await supabaseAdmin()
    .from("trip_invites")
    .insert({ token, trip_id: row.id, created_by: ctx.user!.id, expires_at: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString() });
  if (error) throw error;
  return token;
}

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
async function inviteRow(token: string) {
  if (!TOKEN.test(token)) return null;
  const { data } = await supabaseAdmin().from("trip_invites").select("token, trip_id, expires_at").eq("token", token).maybeSingle();
  return data as { token: string; trip_id: string; expires_at: string } | null;
}

/** What someone sees before joining: just enough to know what they're joining. */
export async function inviteInfo(token: string) {
  const inv = await inviteRow(token);
  if (!inv) return null;
  const { data: t } = await supabaseAdmin().from("trips").select("id, user_id, title, destination, itinerary").eq("id", inv.trip_id).maybeSingle();
  if (!t) return null;
  const names = await namesFor([t.user_id as string]);
  return {
    tripId: t.id as string,
    title: t.title as string,
    destination: t.destination as string,
    days: (t.itinerary as TripRow["itinerary"]).days.length,
    owner: names.get(t.user_id as string)?.name ?? null,
    expired: Date.parse(inv.expires_at) < Date.now(),
  };
}

export async function acceptInvite(ctx: Ctx, token: string): Promise<string> {
  const inv = await inviteRow(token);
  if (!inv) throw new HttpError(404, "That invite link doesn't work. Ask for a new one.");
  if (Date.parse(inv.expires_at) < Date.now()) throw new HttpError(410, "That invite has expired. Ask for a new one.", "expired");
  const { data: t } = await supabaseAdmin().from("trips").select("id, user_id").eq("id", inv.trip_id).maybeSingle();
  if (!t) throw new HttpError(404, "That trip no longer exists.");
  if (t.user_id !== ctx.user!.id) await addMemberRow(t.id as string, ctx.user!.id, t.user_id as string);
  return t.id as string;
}

/** Trips other people are planning with you. */
export async function sharedWithMe(ctx: Ctx): Promise<(TripSummary & { owner: string })[]> {
  if (!ctx.user) return [];
  const db = supabaseAdmin();
  const { data: m, error } = await db.from("trip_members").select("trip_id").eq("user_id", ctx.user.id).limit(100);
  if (error || !m?.length) return [];
  const { data } = await db
    .from("trips")
    .select("id, user_id, created_at, updated_at, destination, title, request, custom_mix, itinerary, saved, rating")
    .in("id", m.map((r) => r.trip_id as string))
    .order("created_at", { ascending: false });
  const names = await namesFor([...new Set((data ?? []).map((r) => r.user_id as string))]);
  return ((data ?? []) as TripRow[]).map((r) => ({ ...toSummary(r), saved: false, rating: 0, owner: names.get(r.user_id)?.name ?? "A friend" }));
}
