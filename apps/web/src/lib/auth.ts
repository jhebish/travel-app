import type { SupabaseClient, User } from "@supabase/supabase-js";
import { HttpError } from "./http";
import { supabaseFromCookies, supabaseFromToken } from "./supabase/server";

export type Role = "traveler" | "local" | "curator" | "admin";

export interface Ctx {
  user: User | null;
  /** Client scoped to the caller: RLS applies. */
  db: SupabaseClient;
  role: Role;
}

/**
 * Web requests authenticate with Supabase session cookies.
 * The mobile app sends `Authorization: Bearer <access token>`.
 */
export async function getCtx(req: Request): Promise<Ctx> {
  const header = req.headers.get("authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const db = token ? supabaseFromToken(token) : supabaseFromCookies();
  const { data } = token ? await db.auth.getUser(token) : await db.auth.getUser();
  const user = data.user ?? null;
  let role: Role = "traveler";
  if (user) {
    const { data: p } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (p?.role) role = p.role as Role;
  }
  return { user, db, role };
}

export async function requireUser(req: Request): Promise<Ctx & { user: User }> {
  const ctx = await getCtx(req);
  if (!ctx.user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  return ctx as Ctx & { user: User };
}

export const isCurator = (r: Role) => r === "curator" || r === "admin";

export async function requireCurator(req: Request) {
  const ctx = await requireUser(req);
  if (!isCurator(ctx.role)) throw new HttpError(403, "Only curators can do this.", "forbidden");
  return ctx;
}
