import { supabaseAdmin } from "./supabase/server";

/**
 * Phone notifications through Expo's push service (no keys needed for Expo push tokens).
 * Best effort: a failure is logged, never thrown, so it can't break the action that triggered it.
 * Tokens Expo reports as gone (the app was deleted, or notifications were turned off) are removed.
 */
export interface PushMessage {
  title: string;
  body: string;
  /** A path in the app to open when tapped, e.g. "/friends?ask=<id>". */
  url: string;
}

const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";

export async function sendPush(userIds: string[], msg: PushMessage): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("push_tokens").select("token").in("user_id", ids);
    if (error || !data?.length) return;
    const tokens = data.map((r) => r.token as string).filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t));
    if (!tokens.length) return;
    const messages = tokens.map((to) => ({
      to,
      title: msg.title.slice(0, 120),
      body: msg.body.slice(0, 240),
      data: { url: msg.url },
      sound: "default",
    }));
    const res = await fetch(EXPO_PUSH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error("push send failed", res.status);
      return;
    }
    const out = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    const gone = (out?.data ?? [])
      .map((r, i) => (r.status === "error" && r.details?.error === "DeviceNotRegistered" ? tokens[i] : null))
      .filter((t): t is string => !!t);
    if (gone.length) await db.from("push_tokens").delete().in("token", gone);
  } catch (e) {
    console.error("push send failed", e);
  }
}
