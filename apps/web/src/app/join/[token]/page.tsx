"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/components/useMe";
import { api } from "@/lib/api";

interface Invite {
  title: string;
  destination: string;
  days: number;
  owner: string | null;
  expired: boolean;
}

/** Someone shared a "plan this trip with me" link. */
export default function Join({ params }: { params: { token: string } }) {
  const me = useMe(); // starts a guest session, so friends can join without signing up
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: Invite }>(`/api/join/${params.token}`)
      .then((r) => setInvite(r.invite))
      .catch((e) => setErr((e as Error).message));
  }, [params.token]);

  async function join() {
    setBusy(true);
    setErr(null);
    try {
      const { tripId } = await api<{ tripId: string }>(`/api/join/${params.token}`, { method: "POST" });
      router.push(`/trips/${tripId}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="cta signup">
        <span className="eyebrow">Plan together</span>
        {invite ? (
          <>
            <h1>{invite.title}</h1>
            <p className="lede">
              {invite.owner ? `${invite.owner} wants` : "A friend wants"} to plan {invite.days} {invite.days === 1 ? "day" : "days"} in {invite.destination.split(",")[0]} with you. Say
              which stops you&apos;re in for, swap what&apos;s not your thing, and Pylos rebuilds days around both of your tastes.
            </p>
            {invite.expired ? (
              <p className="status err">This invite has expired. Ask for a new link.</p>
            ) : (
              <div className="row">
                <button type="button" className="btn" disabled={busy || !me} onClick={join}>
                  {busy ? "Joining…" : "Join the planning"}
                </button>
              </div>
            )}
            {me?.user?.isGuest && (
              <p className="hint">
                You can join as a guest. <Link href={`/login?next=/join/${params.token}`}>Sign in</Link> to keep the trip on all your devices.
              </p>
            )}
          </>
        ) : err ? (
          <p className="status err">{err}</p>
        ) : (
          <p className="hint">Loading the invite…</p>
        )}
        {err && invite && <p className="status err">{err}</p>}
      </section>
    </div>
  );
}
