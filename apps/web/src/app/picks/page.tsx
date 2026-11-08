"use client";
import { PICK_CATEGORIES, SOURCES, STAY_STYLES, STAY_TIERS, isStayTier, tierLabel, type LocalPickInput } from "@travel/core";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SingleChips } from "@/components/Chips";
import { canCurate, canSubmitPicks, useMe } from "@/components/useMe";
import { api } from "@/lib/api";

interface Pick {
  id: string;
  city: string;
  name: string;
  neighborhood: string | null;
  category: string;
  source: string;
  note: string | null;
  tags: string[];
  price_band: string | null;
  stay_style: string | null;
  google_place_id: string | null;
  expedia_property_id: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

const SUBMIT_SOURCES = SOURCES.filter((s) => s.id !== "sponsored" && s.id !== "friends");
const empty: LocalPickInput = { city: "", name: "", neighborhood: "", category: "food", source: "locals", note: "", tags: [], priceBand: null, stayStyle: null };

export default function PicksPage() {
  const me = useMe();
  const curator = canCurate(me?.role);
  const [form, setForm] = useState<LocalPickInput>(empty);
  const [tags, setTags] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [city, setCity] = useState("");
  const [picks, setPicks] = useState<Pick[] | null>(null);

  // Only the latest request's answer is shown, so a slow earlier one can't replace it.
  const latest = useRef(0);
  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (curator) q.set("status", status);
    if (city.trim()) q.set("city", city.trim());
    const n = ++latest.current;
    api<{ picks: Pick[] }>(`/api/picks?${q}`)
      .then((r) => n === latest.current && setPicks(r.picks))
      .catch(() => n === latest.current && setPicks([]));
  }, [curator, status, city]);
  useEffect(() => {
    if (!me?.user || !canSubmitPicks(me.role)) return;
    // Typing in the city filter waits for a pause instead of fetching on every key.
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [me, load]);

  if (me && !canSubmitPicks(me.role))
    return (
      <div className="card">
        <h1>Local picks</h1>
        <p className="lede">{me.user ? "Ask a curator to give you local access to submit picks." : <><Link href="/login?next=/picks">Sign in</Link> to submit picks.</>}</p>
      </div>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = { ...form, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) };
      const r = await api<{ verified: boolean }>("/api/picks", { method: "POST", json: body });
      setMsg({ text: r.verified ? "Submitted and found on Google Maps. It goes live once a curator approves it." : "Submitted. We couldn't match it on Google Maps, so a curator will check it." });
      setForm({ ...empty, city: form.city, source: form.source });
      setTags("");
      load();
    } catch (err) {
      setMsg({ text: (err as Error).message, err: true });
    }
  }

  async function review(id: string, patch: Record<string, unknown>) {
    try {
      await api(`/api/picks/${id}`, { method: "PATCH", json: patch });
      load();
    } catch (err) {
      setMsg({ text: (err as Error).message, err: true });
    }
  }

  return (
    <>
      <form className="card" onSubmit={submit}>
        <div className="head">
          <h1>Local picks</h1>
          <p className="lede">Spots from locals and hosts. Approved picks are the first places the planner draws from in that city.</p>
        </div>
        <div className="two">
          <div className="field">
            <label className="label" htmlFor="p-city">City</label>
            <input id="p-city" type="text" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-hood">Neighborhood</label>
            <input id="p-hood" type="text" value={form.neighborhood ?? ""} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="p-name">Place name</label>
          <input id="p-name" type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <span className="label">Category</span>
          <SingleChips label="Category" options={PICK_CATEGORIES} value={form.category} onChange={(category) => setForm({ ...form, category })} />
        </div>
        {form.category === "stay" && (
          <div className="two">
            <div className="field">
              <span className="label">Style</span>
              <SingleChips label="Stay style" options={STAY_STYLES} value={form.stayStyle} onChange={(stayStyle) => setForm({ ...form, stayStyle })} />
            </div>
            <div className="field">
              <span className="label">Price, for the city</span>
              <SingleChips label="Price for the city" options={STAY_TIERS.map((t) => ({ value: t, label: tierLabel(t) }))} value={form.priceBand} onChange={(priceBand) => setForm({ ...form, priceBand })} />
              <span className="hint">Judged by local prices: a $$ hotel in Cairo costs far less than one in Paris.</span>
            </div>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="p-source">Source</label>
          <select id="p-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as LocalPickInput["source"] })}>
            {SUBMIT_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="p-note">Why it's good</label>
          <textarea id="p-note" maxLength={600} placeholder="What to order, when to go, who it's great for" value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-tags">Tags <small>(comma-separated, e.g. halal, vegetarian, lgbtq, cash only)</small></label>
          <input id="p-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <button className="btn">Submit pick</button>
        <p className={`status${msg?.err ? " err" : ""}`} role="status">{msg?.text}</p>
      </form>

      <div className="card">
        <div className="head">
          <h2>{curator ? "Review queue" : "Your submissions"}</h2>
        </div>
        <div className="row">
          {curator && (
            <div className="seg" role="tablist" aria-label="Status">
              {(["pending", "approved", "rejected"] as const).map((s) => (
                <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          )}
          <input type="text" aria-label="Filter by city" placeholder="Filter by city" value={city} onChange={(e) => setCity(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        </div>
        {!picks ? (
          <span className="thinking"><span className="dot" />Loading picks…</span>
        ) : !picks.length ? (
          <div className="empty"><b>No picks here yet</b></div>
        ) : (
          <ul className="list">
            {picks.map((p) => (
              <PickRow key={p.id} p={p} curator={curator} onReview={review} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function PickRow({ p, curator, onReview }: { p: Pick; curator: boolean; onReview: (id: string, patch: Record<string, unknown>) => void }) {
  const [expedia, setExpedia] = useState(p.expedia_property_id ?? "");
  return (
    <li>
      <div className="list-top">
        <div className="list-title">{p.name}</div>
        <span className="tag">{p.status}</span>
      </div>
      <div className="meta">
        {[p.neighborhood, p.city].filter(Boolean).join(", ")}. {p.category[0]!.toUpperCase() + p.category.slice(1)}
        {p.stay_style ? `, ${p.stay_style.toLowerCase()}` : ""}
        {p.price_band ? (isStayTier(p.price_band) ? `, ${p.price_band} for the city` : `, ${p.price_band} a night`) : ""}. From {SOURCES.find((s) => s.id === p.source)?.name.toLowerCase() ?? p.source}.{" "}
        {p.google_place_id ? "Found on Google Maps." : "Not matched on Google Maps yet."}
      </div>
      {p.note && <p className="why">{p.note}</p>}
      {!!p.tags?.length && <div className="meta">Tags: {p.tags.join(", ")}</div>}
      {curator && (
        <div className="stack" style={{ gap: 10 }}>
          {p.category === "stay" && (
            <div className="row">
              <input type="text" aria-label="Expedia property id" placeholder="Expedia property id (for live rates)" value={expedia} onChange={(e) => setExpedia(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              <button className="btn ghost small" onClick={() => onReview(p.id, { expediaPropertyId: expedia || null })}>Save id</button>
            </div>
          )}
          <div className="row">
            {p.status !== "approved" && <button className="btn ghost small" onClick={() => onReview(p.id, { status: "approved" })}>Approve</button>}
            {p.status !== "rejected" && <button className="btn ghost small danger" onClick={() => onReview(p.id, { status: "rejected" })}>Reject</button>}
            {p.status !== "pending" && <button className="btn ghost small" onClick={() => onReview(p.id, { status: "pending" })}>Back to pending</button>}
          </div>
        </div>
      )}
    </li>
  );
}
