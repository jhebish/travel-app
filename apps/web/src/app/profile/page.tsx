"use client";
import {
  SIGNAL_KIND_LABELS,
  VISIBILITY_LABELS,
  flag,
  travelStats,
  type ForYouPick,
  type MyCommunityProfile,
  type PastTrip,
  type PickKind,
  type Trip,
  type Visibility,
} from "@travel/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, PlaceForm, StatsRow, countryName } from "@/components/community";
import { ConnectCard } from "@/components/connect";
import { MemoryCard, PastTripControls, RecapLink, focusQuickLog } from "@/components/pages";
import { PicksForFriendsSwitch, YourPicks } from "@/components/Friends";
import { QuickLog, type PresetTrip } from "@/components/QuickLog";
import { RankEntry } from "@/components/Rank";
import { RankNudge } from "@/components/RankNudge";
import { CoinCollection } from "@/components/Coins";
import { PlacesMap } from "@/components/PlacesMap";
import { StaysList } from "@/components/Stays";
import { TasteCard, kindFromName, useTaste } from "@/components/taste";
import { canSubmitPicks, useMe } from "@/components/useMe";
import { api, ApiError } from "@/lib/api";

const VIS: { value: Visibility; label: string }[] = [
  { value: "private", label: "Only me" },
  { value: "followers", label: "Followers" },
  { value: "public", label: "Everyone" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Trips shown before "Show all". */
const FIRST_TRIPS = 6;

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

/** "Portugal · May · 5 days" (the year is the heading above). */
const tripLine = (p: PastTrip) => [countryName(p.countryCode), p.month ? MONTHS[p.month - 1] : null, p.days ? `${p.days} ${p.days === 1 ? "day" : "days"}` : null].filter(Boolean).join(" · ");

/** Five stars to tap: the trips rated highest weigh most in your taste. Tap the rating again to clear it. */
function Stars({ value, label, busy, onRate }: { value: number | null; label: string; busy: boolean; onRate: (n: number) => void }) {
  return (
    <span className="stars" role="group" aria-label={`Rate ${label}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star${value && n <= value ? " on" : ""}`}
          aria-label={`${n} of 5`}
          aria-pressed={value === n}
          disabled={busy}
          onClick={() => onRate(n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

/** A spot in the two columns (on phones, one column in this order); hidden when what's in it isn't shown. */
const Slot = ({ order, children }: { order: number; children: React.ReactNode }) => (
  <div className="pslot" style={{ order }}>
    {children}
  </div>
);

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
  const [formErr, setFormErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [rating, setRating] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [picks, setPicks] = useState<ForYouPick[]>([]);
  const logTrip = params.get("log");
  const logCity = params.get("city") ?? "";
  const taste = useTaste(!!me?.user);
  const [preset, setPreset] = useState<PresetTrip | null>(null);
  const settingsDlg = useRef<HTMLDialogElement>(null);
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
    // Where you'd love next: the same picks as Browse (kept per person, so no new prediction here).
    api<{ picks: ForYouPick[]; member: boolean }>("/api/browse/foryou")
      .then((r) => r.member && setPicks(r.picks))
      .catch(() => {});
  }, [me?.user]);

  const stats = useMemo(() => travelStats(places), [places]);

  /** Trips by year, newest first; the first few until "Show all". */
  const years = useMemo(() => {
    const sorted = [...places].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0) || a.city.localeCompare(b.city));
    const shown = showAll ? sorted : sorted.slice(0, FIRST_TRIPS);
    const out = new Map<string, PastTrip[]>();
    for (const p of shown) {
      const y = p.year ? String(p.year) : "Undated";
      out.set(y, [...(out.get(y) ?? []), p]);
    }
    return [...out];
  }, [places, showAll]);

  /** Open a past trip's editor in the list (from a memory, or a ?edit= link from its page). */
  const openEditor = (id: string) => {
    setShowAll(true);
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

  function openSettings() {
    setFormErr(null);
    settingsDlg.current?.showModal();
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormErr(null);
    try {
      const { profile: p } = await api<{ profile: MyCommunityProfile }>("/api/community/profile", { method: "PUT", json: form });
      setMsg({ text: profile ? "Profile saved." : "You're in. Find people on the Friends page." });
      setProfile(p);
      setForm({ ...p });
      settingsDlg.current?.close();
    } catch (e2) {
      setFormErr((e2 as Error).message);
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

  // The whole trip, as the editor sends it; who sees it stays as it was.
  async function rate(p: PastTrip, n: number) {
    const next = p.rating === n ? null : n;
    setRating(p.id);
    try {
      await api(`/api/community/places/${p.id}`, {
        method: "PUT",
        json: { city: p.city, countryCode: p.countryCode, year: p.year, month: p.month, days: p.days, rating: next, highlights: p.highlights, tripId: p.tripId },
      });
      setPlaces((ps) => ps.map((x) => (x.id === p.id ? { ...x, rating: next } : x)));
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    } finally {
      setRating(null);
    }
  }

  async function signOut() {
    await (await supabase()).auth.signOut();
    router.push("/");
    router.refresh();
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
  const email = me?.user?.email ?? "";
  const seed = profile ?? { displayName: form.displayName || email || "You", handle: form.handle || email || "you" };

  return (
    <div className="profile bleed">
      {/* ---------- who you are ---------- */}
      <section className="card profile-hero" aria-label="Your profile">
        <div className="profile-id">
          <Avatar person={seed} size={76} />
          <div className="profile-who">
            <h1 className="profilename">{profile?.displayName ?? "You"}</h1>
            <p className="hint">
              {profile ? (
                <>
                  @{profile.handle}
                  {profile.homeCity ? ` · ${profile.homeCity}` : ""}
                </>
              ) : signedIn ? (
                email
              ) : (
                "Guest"
              )}
            </p>
            {profile?.bio && <p className="profile-bio">{profile.bio}</p>}
          </div>
          {(canJoin || profile) && !off && (
            <div className="profile-actions">
              {canJoin && (
                <button type="button" className="btn ghost sm" onClick={openSettings}>
                  {profile ? "Edit profile" : "Create your profile"}
                </button>
              )}
              {profile && (
                <Link className="btn ghost sm" href={`/u/${profile.handle}`}>
                  Your public page
                </Link>
              )}
            </div>
          )}
        </div>
        <StatsRow stats={stats} showNext />
      </section>
      {msg && (
        <p className={`status${msg.err ? " err" : ""}`} role="status">
          {msg.text}
        </p>
      )}
      {/* On phones this is the only way in to signing in, so it sits at the top. */}
      {me?.user?.isGuest && (
        <p className="note">
          You&apos;re using Pylos as a guest. <Link href="/login?next=/profile">Sign in with your email</Link> to keep your trips and places on every device.
        </p>
      )}
      <RankNudge />

      <div className="profile-grid">
        <div className="profile-col">
          <Slot order={1}>
            <TasteCard data={taste.data} updating={taste.updating} trips={places.length} onLog={focusQuickLog} picks={picks} />
          </Slot>

          {/* ---------- places ---------- */}
          <Slot order={3}>
            <section className="card stack places-card" id="places">
              <div className="head">
                <h2>
                  Places you&apos;ve been{places.length ? <span className="hint tabnum"> · {places.length}</span> : null}
                </h2>
                <p className="hint">Type a city and tick what you loved. Rate the trips you loved most: they weigh most in your taste.</p>
              </div>
              {off && (
                <p className="status err" role="status">
                  {off}
                </p>
              )}
              <PlacesMap version={places.map((p) => p.id).join(",")} />

              {places.length > 0 && (
                <div className="stack" style={{ gap: 12 }}>
                  <div className="head">
                    <h3 className="eyebrow">Your coins</h3>
                    <p className="hint">Every city strikes its own. Bronze for a first visit, silver for a second, gold from the third.</p>
                  </div>
                  <CoinCollection places={places} />
                </div>
              )}

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

              {years.map(([year, list]) => (
                <div key={year} className="tripyear">
                  <h3 className="eyebrow">{year}</h3>
                  <ul className="placelist">
                    {list.map((p) =>
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
                        <li key={p.id} id={`place-${p.id}`} className="triprow">
                          <div className="triprow-top">
                            <div className="triprow-title">
                              <Link href={`/p/${p.id}`}>
                                <span aria-hidden="true">{flag(p.countryCode)}</span> {p.city}
                              </Link>
                              <span className="hint">{tripLine(p)}</span>
                            </div>
                            <Stars value={p.rating} label={p.city} busy={rating === p.id} onRate={(n) => void rate(p, n)} />
                          </div>
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
                          <div className="triprow-actions">
                            <button type="button" className="linkbtn" onClick={() => setEditing(p.id)}>
                              Edit
                            </button>
                            <button type="button" className="linkbtn quiet" aria-expanded={sharing === p.id} onClick={() => setSharing(sharing === p.id ? null : p.id)}>
                              Who sees it: {VISIBILITY_LABELS[p.visibility ?? "followers"]}
                            </button>
                            <button type="button" className="linkbtn danger" onClick={() => removePlace(p.id)}>
                              {confirmRemove === p.id ? "Confirm remove" : "Remove"}
                            </button>
                          </div>
                          {sharing === p.id && (
                            <PastTripControls place={p} member={!!profile} onChange={(np) => setPlaces((ps) => ps.map((x) => (x.id === np.id ? np : x)))} />
                          )}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
              {places.length > FIRST_TRIPS && (
                <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll(!showAll)}>
                  {showAll ? "Show fewer" : `Show all ${places.length} trips`}
                </button>
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
          </Slot>
        </div>

        <div className="profile-col">
          <Slot order={2}>
            <MemoryCard places={places} onAdd={openEditor} />
          </Slot>
          <Slot order={4}>
            <StaysList version={taste.data?.counts.total ?? 0} />
          </Slot>
          <Slot order={5}>
            <RankEntry places={taste.data?.signals.length ?? 0} trips={places.length} />
          </Slot>
          <Slot order={6}>{places.length > 0 && <RecapLink places={places} />}</Slot>
          <Slot order={7}>
            <ConnectCard onImported={taste.reload} />
          </Slot>
          <Slot order={8}>
            {profile ? (
              <YourPicks />
            ) : canJoin && !off ? (
              <section className="card stack">
                <div className="head">
                  <span className="eyebrow">Community</span>
                  <h2>Join the community</h2>
                  <p className="hint">Follow friends, see their trips, and find the best-rated trips in any city.</p>
                </div>
                <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={openSettings}>
                  Create your profile
                </button>
              </section>
            ) : null}
          </Slot>
          <Slot order={9}>
            <section className="card account-card" aria-label="Account">
              <span className="eyebrow">Account</span>
              {signedIn ? (
                <p className="hint">Signed in as {email}</p>
              ) : (
                <p className="hint">
                  Guest accounts can log places but can&apos;t join the community. <Link href="/login?next=/profile">Sign in with your email</Link> to keep everything.
                </p>
              )}
              <div className="account-links">
                <Link href="/sources">Your source mix</Link>
                {canSubmitPicks(me?.role) && <Link href="/picks">Local picks</Link>}
                {signedIn && (
                  <button type="button" className="linkbtn" onClick={() => void signOut()}>
                    Sign out
                  </button>
                )}
                {signedIn && (
                  <button
                    type="button"
                    className="linkbtn danger"
                    onClick={() => {
                      setDeleteErr(null);
                      deleteDlg.current?.showModal();
                    }}
                  >
                    Delete account
                  </button>
                )}
              </div>
            </section>
          </Slot>
        </div>
      </div>

      {/* ---------- community profile ---------- */}
      <dialog ref={settingsDlg} className="sheet wide" aria-labelledby="settings-title" onClick={(e) => e.target === settingsDlg.current && !saving && settingsDlg.current?.close()}>
        <form className="stack" onSubmit={saveProfile}>
          <div className="head">
            <h2 id="settings-title">{profile ? "Edit your profile" : "Join the community"}</h2>
            <p className="hint">
              {profile ? (
                <>
                  People find you as <Link href={`/u/${profile.handle}`}>@{profile.handle}</Link>.
                </>
              ) : (
                "Follow friends, see their trips, and find the best-rated trips in any city."
              )}
            </p>
          </div>
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
          {profile && <PicksForFriendsSwitch />}
          {formErr && (
            <p className="status err" role="alert">
              {formErr}
            </p>
          )}
          <div className="row">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Saving…" : profile ? "Save profile" : "Create my profile"}
            </button>
            <button type="button" className="linkbtn" disabled={saving} onClick={() => settingsDlg.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={deleteDlg} className="sheet" aria-labelledby="delete-title" onClick={(e) => e.target === deleteDlg.current && !deleting && deleteDlg.current?.close()}>
        <div className="stack">
          <div className="head">
            <h2 id="delete-title">Delete your account?</h2>
            <p className="hint">
              This permanently deletes your trips, saved places, taste profile and community profile for {email || "this account"}. It can&apos;t be undone.
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
