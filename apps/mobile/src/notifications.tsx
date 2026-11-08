import type { RankNudges } from "@travel/core";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef } from "react";
import { AppState, Linking, Platform } from "react-native";
import { api } from "./api";
import { useAuth } from "./auth";
import { supabase } from "./supabase";

/**
 * Phone notifications.
 *  * Reminders: a local notification at 9:00 the morning after each dated Pylos trip ends
 *    ("Back from Lisbon? Rank 5 spots in 60 seconds."), scheduled on the phone and re-synced each
 *    time the app opens, so changed or deleted trips don't leave stale ones behind.
 *  * Push: once allowed, the phone's Expo push token is registered with the server (friends asking
 *    about a city, answers…), and unregistered when the person signs out.
 *  * Taps: a notification's `data.url` is a path on the web app. Paths the app has a screen for
 *    open that screen; anything else opens on the website.
 * Permission is asked only when someone chooses to turn reminders on (see ReminderOptIn), never at
 * first launch.
 */

const WEB = (process.env.EXPO_PUBLIC_API_URL ?? "https://www.pylos.ai").replace(/\/$/, "");
/** Android channel; also where pushes without a channel land. */
const CHANNEL = "default";
const REMINDER = "rank-reminder:";
const PUSH_KEY = "pylos.push";

// Notifications that arrive while the app is open still show.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export type NotifyPermission = "granted" | "undetermined" | "denied";

export async function notifyPermission(): Promise<NotifyPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return "granted";
  return p.canAskAgain ? "undetermined" : "denied";
}

async function ensureChannel() {
  // Android 13+ only shows the permission prompt once a channel exists.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Trips and friends", importance: Notifications.AndroidImportance.DEFAULT });
  }
}

/** The person chose to turn reminders on: ask, then schedule and register straight away. */
export async function askToNotify(): Promise<boolean> {
  await ensureChannel().catch(() => {});
  const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  if (!r.granted && r.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return false;
  await Promise.all([syncReminders(true).catch(() => {}), registerPush().catch(() => {})]);
  return true;
}

// ---------------------------------------------------------------------------
// Morning-after reminders
// ---------------------------------------------------------------------------
let lastSync = 0;

/** Schedule a reminder for each upcoming trip's morning after; cancel ones no longer wanted. */
export async function syncReminders(force = false): Promise<void> {
  if (!force && Date.now() - lastSync < 10 * 60_000) return;
  if ((await notifyPermission()) !== "granted") return;
  lastSync = Date.now();
  await ensureChannel().catch(() => {});
  const { upcoming } = await api<RankNudges>("/api/rank/nudges");
  const want = new Map<string, { at: Date; city: string; url: string; overOn: string }>();
  for (const n of upcoming) {
    const [y, m, d] = n.overOn.split("-").map(Number) as [number, number, number];
    const at = new Date(y, m - 1, d, 9, 0, 0); // 9:00 on the phone's clock, wherever it is
    if (at.getTime() > Date.now() + 60_000) want.set(`${REMINDER}${n.key}`, { at, city: n.city, url: n.href, overOn: n.overOn });
  }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    if (!s.identifier.startsWith(REMINDER)) continue;
    const w = want.get(s.identifier);
    const data = s.content.data as { url?: string; overOn?: string } | undefined;
    if (w && data?.overOn === w.overOn && data?.url === w.url) want.delete(s.identifier); // already right
    else await Notifications.cancelScheduledNotificationAsync(s.identifier);
  }
  for (const [identifier, w] of want) {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: `Back from ${w.city}?`,
        body: "Rank 5 spots in 60 seconds. It makes your next plan even better.",
        data: { url: w.url, overOn: w.overOn },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: w.at, channelId: CHANNEL },
    });
  }
}

async function cancelReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter((s) => s.identifier.startsWith(REMINDER)).map((s) => Notifications.cancelScheduledNotificationAsync(s.identifier)));
  lastSync = 0;
}

// ---------------------------------------------------------------------------
// Push token
// ---------------------------------------------------------------------------

/** The EAS project id push tokens are issued for, from app config (app.json extra.eas.projectId). */
const projectId = (): string | undefined => {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
};

let warnedNoProject = false;

/** Register this phone for pushes (signed-in people only; guests aren't notified). */
export async function registerPush(): Promise<void> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) return;
  if ((await notifyPermission()) !== "granted") return;
  const id = projectId();
  if (!id) {
    // Without an EAS project there are no Expo push tokens; local reminders still work.
    if (!warnedNoProject) console.info("Push notifications are off: set expo.extra.eas.projectId in app.json (run `eas init`).");
    warnedNoProject = true;
    return;
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  const saved = await SecureStore.getItemAsync(PUSH_KEY).catch(() => null);
  if (saved === `${user.id}|${token}`) return; // already registered for this person
  await api("/api/push/register", { method: "POST", json: { token, platform: Platform.OS } });
  await SecureStore.setItemAsync(PUSH_KEY, `${user.id}|${token}`).catch(() => {});
}

async function unregisterPush() {
  const saved = await SecureStore.getItemAsync(PUSH_KEY).catch(() => null);
  const token = saved?.split("|")[1];
  if (!token) return;
  await api("/api/push/register", { method: "DELETE", json: { token } }).catch(() => {});
  await SecureStore.deleteItemAsync(PUSH_KEY).catch(() => {});
}

/**
 * Sign out on this phone. While still signed in, stop this person's pushes to it and their trip
 * reminders on it, so the next person to use the phone doesn't get them.
 */
export async function signOut(): Promise<void> {
  await Promise.all([unregisterPush(), cancelReminders()]).catch(() => {});
  await supabase.auth.signOut();
}

// ---------------------------------------------------------------------------
// Opening a notification
// ---------------------------------------------------------------------------
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The app's screen for a web path ("/rank?plan=…", "/trips/<id>"), or null when there isn't one. */
export function appRoute(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const [pathname = "", search = ""] = path.split("#")[0]!.split("?", 2);
  const q = new URLSearchParams(search);
  if (pathname === "/rank") return `/rank${search ? `?${search}` : ""}`;
  const trip = new RegExp(`^/trips/(${UUID})$`, "i").exec(pathname);
  if (trip) return q.get("rank") ? `/rank?plan=${trip[1]}` : `/trip/${trip[1]}`;
  if (pathname === "/trips") return "/trips";
  if (pathname === "/profile") return "/you";
  if (pathname === "/" || pathname === "/plan") return "/";
  return null;
}

/** Open a notification's link: the app's own screen when it has one, otherwise our website. */
export function openLink(url: string, router: ReturnType<typeof useRouter>) {
  let path = url;
  if (/^https:\/\//i.test(url)) {
    // Only our own site: a notification can't send someone to any other address.
    if (!WEB || !url.toLowerCase().startsWith(`${WEB.toLowerCase()}/`)) return;
    path = url.slice(WEB.length);
  }
  const route = appRoute(path);
  if (route) router.push(route);
  else if (path.startsWith("/") && !path.startsWith("//") && WEB) Linking.openURL(`${WEB}${path}`).catch(() => {});
}

/**
 * Mounted once, next to the app's navigator: opens tapped notifications (including the one that
 * launched the app), and re-syncs reminders and the push token when the app opens.
 */
export function NotificationsBridge() {
  const router = useRouter();
  const { session, ready } = useAuth();
  const pending = useRef<string | null>(null);
  const handled = useRef(new Set<string>());
  const isReady = useRef(ready);
  isReady.current = ready;

  useEffect(() => {
    const take = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const key = `${r.notification.request.identifier}@${r.notification.date}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      Notifications.clearLastNotificationResponse();
      const url = (r.notification.request.content.data as { url?: unknown } | undefined)?.url;
      if (typeof url !== "string") return;
      if (isReady.current) setTimeout(() => openLink(url, router), 0);
      else pending.current = url; // wait for the session, so the screen can load
    };
    // The notification that opened the app, then any tapped while it's running.
    Notifications.getLastNotificationResponseAsync()
      .then(take)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(take);
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (ready && pending.current) {
      const url = pending.current;
      pending.current = null;
      setTimeout(() => openLink(url, router), 0);
    }
  }, [ready, router]);

  const userId = session?.user.id;
  useEffect(() => {
    if (!ready || !userId) return;
    // A different person (or a guest after signing out): their reminders replace the last ones.
    const sync = (force = false) => {
      void syncReminders(force).catch(() => {});
      void registerPush().catch(() => {});
    };
    sync(true);
    const sub = AppState.addEventListener("change", (s) => s === "active" && sync());
    return () => sub.remove();
  }, [ready, userId]);

  return null;
}
