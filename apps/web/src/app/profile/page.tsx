"use client";
import { SIGNAL_KIND_LABELS, travelStats, type MyCommunityProfile, type PastTrip, type PickKind, type Trip, type Visibility } from "@travel/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PlaceChip, PlaceForm, StatsRow, countryName } from "@/components/community";
import { ConnectCard } from "@/components/connect";
import { MemoryCard, PastTripControls, RecapLink, focusQuickLog } from "@/components/pages";
import { QuickLog, type PresetTrip } from "@/components/QuickLog";
import { RankEntry } from "@/components/Rank";
import { RankNudge } from "@/components/RankNudge";
import { TasteCard, kindFromName, useTaste } from "@/components/taste";
import { canSubmitPicks, useMe } from "@/components/useMe";
import { api, ApiError } from "@/lib/api";

const VIS: { value: Visibility; label: string }[] = [
  { value: "private", label: "Only me" },
  { value: "followers", label: "Followers" },
  { value: "public", label: "Everyone" },
];

/** The Supabase client is only needed to sign out, so it's loaded when someone does. */
const supabase = () => import("@/lib/supabase/browser").then((m) => m.supabaseBrowser());

const suggestHandle = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);

function ProfileEditor() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const [loaded, setLoaded] = useState(false);
  const [off, setOff] = useState<string | null>(null);
  const [canJoin, setCanJoin] = useState(false);
  const [profile, setProfile] = useState<MyCommunityProfile | null>(null);
  const [places, setPlaces] = useState<PastTrip[]>([]);
  const [form, setForm] = useState({ handle: "", displayName: "", homeCity: "", bio: "", defaultVisibility: "followers" as Visibility, placesPublic: false });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const logTrip = params.get("log");
  const logCity = params.get("city") ?? "";
  const taste = useTaste(!!me?.user);
  const [preset, setPreset] = useState<PresetTrip | null>(null);
  const deleteDlg = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function deleteAccount() {
    setDeleting(true);
    setDeleteErr(null);
    try {
      await api("/api/me", { method: "DELETE", json: { confirm: "delete" } });
      // The account is gone; drop this browser's session too.
      await supabase()
        .then((sb) => sb.auth.signOut({ scope: "local" }))
        .catch(() => {});
      window.location.href = "/";
    } catch (e) {
      setDeleteErr(e instanceof ApiError ? e.message : "We couldn't delete your account. Try again.");
      setDeleting(false);
    }
  }

  // Logging a Pylos trip ("I went"): tick what you loved from that plan's hotels and stops.
  useEffect(() => {
    if (!logTrip || !me?.user) return;
    api<{ trip: Trip }>(`/api/trips/${logTrip}`)
      .then(({ trip }) => {
        const it = trip.itinerary;
        setPreset({
          tripId: logTrip,
          city: logCity || trip.destination.split(",")[0]!.trim(),
          picks: [
            ...(it.hotels ?? []).map((h) => ({ kind: "stay" as PickKind, name: h.name, note: h.neighborhood ?? "" })),
            ...it.days.flatMap((d) => d.stops).map((st) => ({ kind: kindFromName(st.name) as PickKind, name: st.name, note: st.neighborhood ?? "" })),
          ].slice(0, 40),
        });
      })
      .catch(() => {});
  }, [logTrip, logCity, me?.user]);

  /** What they did on each logged trip, from their taste signals. */
  const itemsByTrip = useMemo(() => {
    const m = new Map<string, { kind: string; name: string; liked?: boolean | null }[]>();
    for (const sg of taste.data?.signals ?? []) {
      if (!sg.pastTripId) continue;
      m.set(sg.pastTripId, [...(m.get(sg.pastTripId) ?? []), sg]);
    }
    return m;
  }, [taste.data]);

  useEffect(() => {
    if (!me?.user) return;
    api<{ profile: MyCommunityProfile | null; places: PastTrip[]; canJoin: boolean }>("/api/community/profile")
      .then((r) => {
        setProfile(r.profile);
        setPlaces(r.places);
        setCanJoin(r.canJoin);
        if (r.profile) setForm({ ...r.profile });
        else {
          const name = me.user?.email?.split("@")[0] ?? "";
          setForm((f) => ({ ...f, handle: suggestHandle(name), displayName: name ? name[0]!.toUpperCase() + name.slice(1) : "" }));
        }
      })
      .catch((e) => setOff(e instanceof ApiError && e.code === "community_off" ? e.message : (e as Error).message))
      .finally(() => setLoaded(true));
  }, [me?.user]);

  const stats = useMemo(() => travelStats(places), [places]);

  /** Open a past trip's editor in the list (from a memory, or a ?edit= link from its page). */
  const openEditor = (id: string) => {
    setEditing(id);
    setTimeout(() => document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const editParam = params.get("edit");
  const openedEdit = useRef(false);
  useEffect(() => {
    if (!editParam || openedEdit.current || !places.some((p) => p.id === editParam)) return;
    openedEdit.current = true;
    openEditor(editParam);
  }, [editParam, places]);
  const alreadyLogged = logTrip ? places.some((p) => p.tripId === logTrip) : false;

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const { profile: p } = await api<{ profile: MyCommunityProfile }>("/api/community/profile", { method: "PUT", json: form });
      setProfile(p);
      setForm({ ...p });
      setMsg({ text: profile ? "Saved." : "You're in. Find people on the Friends page." });
    } catch (e2) {
      setMsg({ text: (e2 as Error).message, err: true });
    } finally {
      setSaving(false);
    }
  }

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  async function removePlace(id: string) {
    if (confirmRemove !== id) return setConfirmRemove(id);
    setConfirmRemove(null);
    try {
      await api(`/api/community/places/${id}`, { method: "DELETE" });
      setPlaces((ps) => ps.filter((p) => p.id !== id));
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    }
  }

  if (me && !me.user) {
    return (
      <div className="stack" style={{ gap: 22 }}>
        <div className="head">
          <h1>You</h1>
          <p className="lede">Your past trips, your taste, and the accounts that help Pylos plan for you.</p>
        </div>
        <div className="card empty">
          <b>Sign in to log your trips and teach Pylos your taste</b>
          <Link href="/login?next=/profile">Sign in</Link>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="card"><p className="hint">Loading…</p></div>;

  const signedIn = !!me?.user && !me.user.isGuest;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="head">
        <h1>You</h1>
        <p className="lede">Your past trips, your taste, and the accounts that help Pylos plan for you.</p>
      </div>
      <RankNudge />
      {/* On phones this is the only way in to signing in, so it sits at the top. */}
      {me?.user?.isGuest && (
        <p className="note">
          You&apos;re using Pylos as a guest. <Link href="/login?next=/profile">Sign in with your email</Link> to keep your trips and places on every device.
        </p>
      )}

      <TasteCard data={taste.data} updating={taste.updating} trips={places.length} onLog={focusQuickLog} />
      <MemoryCard places={places} onAdd={openEditor} />
      <RankEntry places={taste.data?.signals.length ?? 0} trips={places.length} />

      {/* ---------- places ---------- */}
      <section className="card stack">
        <div className="head">
          <h2>Places you&apos;ve been</h2>
          <p className="hint">Type a city, tick what you loved, hit Next. Pylos learns your taste from it, and you climb the ranks among friends.</p>
        </div>
        {off && (
          <p className="status err" role="status">
            {off}
          </p>
        )}
        <StatsRow stats={stats} showNext />
        {places.length > 0 && <RecapLink places={places} />}

        <QuickLog
          preset={alreadyLogged ? null : preset}
          onPresetDone={() => {
            setPreset(null);
            router.replace("/profile", { scroll: false });
          }}
          onSaved={(p) => {
            setPlaces((ps) => [p, ...ps]);
            taste.reload();
          }}
        />

        {places.length > 0 && (
          <ul className="placelist">
            {places.map((p) =>
              editing === p.id ? (
                <li key={p.id} id={`place-${p.id}`}>
                  <PlaceForm
                    initial={{ id: p.id, value: { ...p } }}
                    onSaved={(np) => {
                      setPlaces((ps) => ps.map((x) => (x.id === np.id ? np : x)));
                      setEditing(null);
                      taste.reload();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={p.id} className="placerow">
                  <div>
                    <PlaceChip place={p} />
                    <span className="hint">
                      {" "}
                      {countryName(p.countryCode)}
                      {p.days ? ` · ${p.days} days` : ""}
                      {p.rating ? ` · ${"★".repeat(p.rating)}` : ""}
                    </span>
                    {p.highlights && <p className="placehi">{p.highlights}</p>}
                    {!!itemsByTrip.get(p.id)?.length && (
                      <p className="placeitems">
                        {itemsByTrip.get(p.id)!.map((it, i) => (
                          <span key={i}>
                            <small>{SIGNAL_KIND_LABELS[it.kind as keyof typeof SIGNAL_KIND_LABELS] ?? ""}</small> {it.name}
                            {it.liked === true ? " ♥" : ""}
                          </span>
                        ))}
                      </p>
                    )}
                    <PastTripControls place={p} member={!!profile} onChange={(np) => setPlaces((ps) => ps.map((x) => (x.id === np.id ? np : x)))} />
                  </div>
                  <div className="row tight">
                    <button type="button" className="linkbtn" onClick={() => setEditing(p.id)}>
                      Edit
                    </button>
                    <button type="button" className="linkbtn danger" onClick={() => removePlace(p.id)}>
                      {confirmRemove === p.id ? "Confirm remove" : "Remove"}
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        <details className="more">
          <summary>Add a trip with more detail</summary>
          <PlaceForm
            defaultVisibility={profile?.placesPublic ? "public" : "followers"}
            onSaved={(p) => {
              setPlaces((ps) => [p, ...ps]);
              taste.reload();
            }}
          />
        </details>
      </section>

      <ConnectCard onImported={taste.reload} />

      {/* ---------- community profile ---------- */}
      {!off && (
      <section className="card stack">
        <div className="head">
          <h2>{profile ? "Your community profile" : "Join the community"}</h2>
          <p className="lede">
            {profile ? (
              <>
                People find you as <Link href={`/u/${profile.handle}`}>@{profile.handle}</Link>.
              </>
            ) : (
              "Follow friends, see their trips, and find the best-rated trips in any city."
            )}
          </p>
        </div>
        {!canJoin ? (
          <p className="note">
            Guest accounts can log places but can&apos;t join the community. <Link href="/login?next=/profile">Sign in with your email</Link> to create a profile; your trips and places come with you.
          </p>
        ) : (
          <form className="stack" onSubmit={saveProfile}>
            <div className="two">
              <div className="field">
                <label className="label" htmlFor="cp-name">
                  Name
                </label>
                <input id="cp-name" type="text" maxLength={60} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
              </div>
              <div className="field">
                <label className="label" htmlFor="cp-handle">
                  Handle
                </label>
                <div className="prefixed">
                  <span>@</span>
                  <input
                    id="cp-handle"
                    type="text"
                    maxLength={24}
                    autoCapitalize="none"
                    spellCheck={false}
                    value={form.handle}
                    onChange={(e) => setForm({ ...form, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                    required
                  />
                </div>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="cp-city">
                Home city <small>(optional)</small>
              </label>
              <input id="cp-city" type="text" maxLength={80} value={form.homeCity} onChange={(e) => setForm({ ...form, homeCity: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="cp-bio">
                Bio <small>(optional)</small>
              </label>
              <textarea id="cp-bio" maxLength={280} placeholder="Chasing natural wine bars and long walks." value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            </div>
            <div className="field">
              <span className="label">Who sees new trips you build</span>
              <div className="seg" role="group" aria-label="Default trip visibility">
                {VIS.map((v) => (
                  <button key={v.value} type="button" aria-pressed={form.defaultVisibility === v.value} onClick={() => setForm({ ...form, defaultVisibility: v.value })}>
                    {v.label}
                  </button>
                ))}
              </div>
              <span className="hint">You can change any trip from its Share menu. The personal details you enter when planning are never shown.</span>
            </div>
            <label className="switch" htmlFor="cp-places">
              <div>
                <b>New places are for everyone</b>
                <span>Off: new places you log are for followers. You can change who sees each one in your list. Everyone sees your counts.</span>
              </div>
              <input id="cp-places" type="checkbox" checked={form.placesPublic} onChange={(e) => setForm({ ...form, placesPublic: e.target.checked })} />
            </label>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Saving…" : profile ? "Save profile" : "Create my profile"}
            </button>
          </form>
        )}
        {msg && (
          <p className={`status${msg.err ? " err" : ""}`} role="status">
            {msg.text}
          </p>
        )}
      </section>
      )}

      <section className="card stack" aria-label="Account">
        <div className="row between">
          <Link href="/sources">Your source mix →</Link>
          {canSubmitPicks(me?.role) && <Link href="/picks">Local picks →</Link>}
        </div>
        {signedIn ? (
          <div className="row between">
            <span className="hint">Signed in as {me?.user?.email}</span>
            <button
              type="button"
              className="linkbtn"
              onClick={async () => {
                await (await supabase()).auth.signOut();
                router.push("/");
                router.refresh();
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
        {signedIn && (
          <button
            type="button"
            className="linkbtn danger"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              setDeleteErr(null);
              deleteDlg.current?.showModal();
            }}
          >
            Delete account
          </button>
        )}
      </section>

      <dialog ref={deleteDlg} className="sheet" aria-labelledby="delete-title" onClick={(e) => e.target === deleteDlg.current && !deleting && deleteDlg.current?.close()}>
        <div className="stack">
          <div className="head">
            <h2 id="delete-title">Delete your account?</h2>
            <p className="hint">
              This permanently deletes your trips, saved places, taste profile and community profile for {me?.user?.email ?? "this account"}. It can&apos;t be undone.
            </p>
          </div>
          <button type="button" className="btn ghost danger" disabled={deleting} onClick={deleteAccount}>
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
          <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} disabled={deleting} onClick={() => deleteDlg.current?.close()}>
            Cancel
          </button>
          {deleteErr && (
            <p className="status err" role="alert">
              {deleteErr}
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ProfileEditor />
    </Suspense>
  );
}
