"use client";
import { travelStats, type MyCommunityProfile, type PastTrip, type Visibility } from "@travel/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PlaceChip, PlaceForm, StatsRow, blankPlace, countryName } from "@/components/community";
import { useMe } from "@/components/useMe";
import { api, ApiError } from "@/lib/api";

const VIS: { value: Visibility; label: string }[] = [
  { value: "private", label: "Only me" },
  { value: "followers", label: "Followers" },
  { value: "public", label: "Everyone" },
];

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
  const alreadyLogged = logTrip ? places.some((p) => p.tripId === logTrip) : false;

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const { profile: p } = await api<{ profile: MyCommunityProfile }>("/api/community/profile", { method: "PUT", json: form });
      setProfile(p);
      setForm({ ...p });
      setMsg({ text: profile ? "Saved." : "You're in. Find friends on the Community page." });
    } catch (e2) {
      setMsg({ text: (e2 as Error).message, err: true });
    } finally {
      setSaving(false);
    }
  }

  async function removePlace(id: string) {
    try {
      await api(`/api/community/places/${id}`, { method: "DELETE" });
      setPlaces((ps) => ps.filter((p) => p.id !== id));
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    }
  }

  if (me && !me.user) {
    return (
      <div className="card empty">
        <b>Sign in to set up your profile</b>
        <Link href="/login?next=/profile">Sign in</Link>
      </div>
    );
  }
  if (!loaded) return <div className="card"><p className="hint">Loading…</p></div>;
  if (off) return <div className="card"><p className="status err">{off}</p></div>;

  return (
    <div className="stack" style={{ gap: 22 }}>
      {/* ---------- places ---------- */}
      <section className="card stack">
        <div className="head">
          <h1>Places you&apos;ve been</h1>
          <p className="lede">Log past trips and what you loved. Ayoush uses them to plan trips that fit your taste, and you climb the ranks among friends.</p>
        </div>
        <StatsRow stats={stats} showNext />

        {logTrip && !alreadyLogged && (
          <div className="callout stack">
            <b>Log your {logCity || "Ayoush"} trip</b>
            <PlaceForm
              initial={{ value: blankPlace(logCity, logTrip) }}
              onSaved={(p) => {
                setPlaces((ps) => [p, ...ps]);
                setMsg({ text: `${p.city} added.` });
              }}
            />
          </div>
        )}

        {places.length > 0 && (
          <ul className="placelist">
            {places.map((p) =>
              editing === p.id ? (
                <li key={p.id}>
                  <PlaceForm
                    initial={{ id: p.id, value: { ...p } }}
                    onSaved={(np) => {
                      setPlaces((ps) => ps.map((x) => (x.id === np.id ? np : x)));
                      setEditing(null);
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
                  </div>
                  <div className="row tight">
                    <button type="button" className="linkbtn" onClick={() => setEditing(p.id)}>
                      Edit
                    </button>
                    <button type="button" className="linkbtn danger" onClick={() => removePlace(p.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        <details className="more" open={places.length === 0 && !logTrip}>
          <summary>Add a place</summary>
          <PlaceForm onSaved={(p) => setPlaces((ps) => [p, ...ps])} />
        </details>
      </section>

      {/* ---------- community profile ---------- */}
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
                <b>Show my places to everyone</b>
                <span>Off: only followers see where you&apos;ve been. Everyone sees your counts.</span>
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
