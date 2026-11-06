"use client";
import type { PersonDTO, Together, TripPerson } from "@travel/core";
import { forwardRef, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Avatar } from "./community";
import { IconLink } from "./icons";

const asPerson = (p: TripPerson) => ({ displayName: p.name, handle: p.handle ?? p.userId });

/** Little faces next to a stop: who's in for it. */
export function WhoIsIn({ people, by }: { people: TripPerson[]; by?: Record<string, 1 | -1> }) {
  const ins = people.filter((p) => by?.[p.userId] === 1);
  if (!ins.length) return null;
  return (
    <span className="whoin" aria-label={`In: ${ins.map((p) => (p.me ? "you" : p.name)).join(", ")}`} title={`In: ${ins.map((p) => (p.me ? "you" : p.name)).join(", ")}`}>
      {ins.slice(0, 3).map((p) => (
        <Avatar key={p.userId} person={asPerson(p)} size={22} />
      ))}
      {ins.length > 3 && <small>+{ins.length - 3}</small>}
    </span>
  );
}

/** Who's planning this trip, invite links, adding friends, leaving. */
export const TogetherSheet = forwardRef<
  HTMLDialogElement,
  { tripId: string; isOwner: boolean; together: Together | null; onChange: (t: Together) => void; onLeft: () => void }
>(function TogetherSheet({ tripId, isOwner, together, onChange, onLeft }, ref) {
  const [friends, setFriends] = useState<PersonDTO[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const close = () => (typeof ref === "object" && ref?.current ? ref.current.close() : undefined);

  useEffect(() => {
    api<{ together: Together; friends: PersonDTO[] }>(`/api/trips/${tripId}/together`)
      .then((r) => {
        onChange(r.together);
        setFriends(r.friends);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const people = together?.people ?? [];
  const inTrip = new Set(people.map((p) => p.userId));

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const makeInvite = () =>
    run("invite", async () => {
      const { url } = await api<{ url: string }>(`/api/trips/${tripId}/together`, { method: "POST", json: { action: "invite" } });
      setInvite(url);
      if (typeof navigator !== "undefined" && "share" in navigator) await navigator.share({ url }).catch(() => {});
    });
  const add = (handle: string) =>
    run(handle, async () => {
      const { together: t } = await api<{ together: Together }>(`/api/trips/${tripId}/together`, { method: "POST", json: { action: "add", handle } });
      onChange(t);
    });
  const remove = (p: TripPerson) =>
    run(p.userId, async () => {
      await api(`/api/trips/${tripId}/together/people/${p.userId}`, { method: "DELETE" });
      if (p.me) return onLeft();
      if (together) onChange({ ...together, people: together.people.filter((x) => x.userId !== p.userId) });
    });

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="tog-title" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="stack">
        <div className="head">
          <h2 id="tog-title">Plan together</h2>
          <p className="hint">
            Friends you add can see this plan, say which stops they&apos;re in for, swap stops and rebuild days. Pylos plans around everyone&apos;s taste.
          </p>
        </div>
        <ul className="people">
          {people.map((p) => (
            <li key={p.userId}>
              <Avatar person={asPerson(p)} size={34} />
              <span className="people-name">
                <b>{p.me ? "You" : p.name}</b>
                <small>{p.owner ? "Organizer" : "Planning with you"}</small>
              </span>
              {isOwner && !p.owner && (
                <button type="button" className="linkbtn danger" disabled={!!busy} onClick={() => remove(p)}>
                  Remove
                </button>
              )}
              {!isOwner && p.me && (
                <button type="button" className="linkbtn danger" disabled={!!busy} onClick={() => remove(p)}>
                  Leave trip
                </button>
              )}
            </li>
          ))}
          {people.length <= 1 && <li className="hint">Just you so far.</li>}
        </ul>

        <div className="field">
          <span className="label">Invite with a link</span>
          {invite ? (
            <div className="copyrow">
              <input type="text" readOnly value={invite} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  navigator.clipboard.writeText(invite).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  })
                }
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <button type="button" className="btn ghost" style={{ alignSelf: "flex-start" }} disabled={busy === "invite"} onClick={makeInvite}>
              <IconLink />
              {busy === "invite" ? "Making a link…" : "Create invite link"}
            </button>
          )}
          <span className="hint">Anyone with the link can join the planning for two weeks. They don&apos;t need an account.</span>
        </div>

        {isOwner && (
          <div className="field">
            <span className="label">Add friends</span>
            {friends.filter((f) => !inTrip.has(f.userId)).length ? (
              <ul className="people">
                {friends
                  .filter((f) => !inTrip.has(f.userId))
                  .map((f) => (
                    <li key={f.userId}>
                      <Avatar person={f} size={34} />
                      <span className="people-name">
                        <b>{f.displayName}</b>
                        <small>@{f.handle}</small>
                      </span>
                      <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => add(f.handle)}>
                        {busy === f.handle ? "Adding…" : "Add"}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <span className="hint">Friends who follow you back show up here. Or send an invite link.</span>
            )}
          </div>
        )}
        {err && (
          <p className="status err" role="status">
            {err}
          </p>
        )}
        <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={close}>
          Done
        </button>
      </div>
    </dialog>
  );
});
