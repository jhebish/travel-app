"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Provider = "google_calendar" | "gmail" | "facebook";
interface Status {
  providers: Record<Provider, { configured: boolean; lastImportAt: string | null; found: number }>;
}

/** Only sign-in connections: one tap, read once, nothing to download or upload. */
const ROWS: { provider: Provider; name: string; what: string }[] = [
  {
    provider: "google_calendar",
    name: "Google Calendar",
    what: "Past trips, hotel stays and dinner reservations, including the Resy and OpenTable bookings that land in your calendar.",
  },
  {
    provider: "gmail",
    name: "Gmail",
    what: "Hotel, flight, restaurant and tour confirmations from the last six years. Pylos reads only each one's sender, subject, date and preview, and keeps the places and dates, never your emails. Reading takes up to a minute.",
  },
  { provider: "facebook", name: "Facebook", what: "Check-ins and places you were tagged at." },
];

const ERRORS: Record<string, string> = {
  not_configured: "That connection isn't switched on yet.",
  denied: "You didn't give access, so nothing was read.",
  expired: "That took too long or came from another session. Try connecting again.",
  failed: "We couldn't read your account just now. Try again in a minute.",
  unknown: "Unknown connection.",
  rate_limited: "You've connected a few times this hour. Try again a little later.",
  not_ready: "That connection isn't fully set up yet, so nothing was kept.",
};

/** Sign in to an account once; Pylos keeps only the places and trips it finds. */
export function ConnectCard({ onImported }: { onImported: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  useEffect(() => {
    api<Status>("/api/connect/status").then(setStatus).catch(() => {});
  }, []);

  // Back from Google or Facebook: handle each return once, whatever re-renders follow.
  const handled = useRef<string | null>(null);
  const imported = useRef(onImported);
  imported.current = onImported;
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("connect_error");
    if (!connected && !error) return;
    const key = params.toString();
    if (handled.current === key) return;
    handled.current = key;
    if (connected) {
      const found = Number(params.get("found") ?? 0);
      const trips = Number(params.get("trips") ?? 0);
      const name = ROWS.find((r) => r.provider === connected)?.name ?? "your account";
      setMsg({
        text: found
          ? `Read ${name} once: ${found} ${found === 1 ? "place" : "places"}${trips ? ` and ${trips} past ${trips === 1 ? "trip" : "trips"}` : ""}. Access was handed straight back; we don't keep it.`
          : `Connected ${name}, but found no trips, stays or reservations.`,
      });
      if (found) imported.current();
    } else {
      setMsg({ text: ERRORS[error ?? ""] ?? ERRORS.failed!, err: true });
    }
    router.replace("/profile#connect", { scroll: false });
  }, [params, router]);

  // Only services that are set up are offered; with none, the card isn't shown (a message from a
  // return trip to Google still is).
  const rows = ROWS.filter((r) => status?.providers[r.provider]?.configured);
  if (!rows.length && !msg) return null;

  return (
    <section className="card stack connect" id="connect">
      <div className="head">
        <span className="eyebrow">Connect</span>
        <h2>Sign in to bring in where you&apos;ve been</h2>
        <p className="hint">
          One tap. Pylos reads the account once, keeps only the places and trips it finds, and hands the access straight back. You can remove anything it adds.
        </p>
      </div>
      {msg && (
        <p className={`status${msg.err ? " err" : ""}`} role="status">
          {msg.text}
        </p>
      )}
      <ul className="connect-list">
        {rows.map((r) => {
          const st = status?.providers[r.provider];
          return (
            <li key={r.provider} className="connect-row">
              <div className="connect-text">
                <b>{r.name}</b>
                <span className="hint">{r.what}</span>
                {st?.lastImportAt && (
                  <span className="hint">
                    Last read {new Date(st.lastImportAt).toLocaleDateString()} · {st.found} found
                  </span>
                )}
              </div>
              <div className="connect-actions">
                <a className="btn sm" href={`/api/connect/${r.provider}/start`}>
                  {st?.lastImportAt ? "Read again" : "Connect"}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
