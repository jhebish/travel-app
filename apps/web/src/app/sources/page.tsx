"use client";
import { SOURCE_BY_ID, defaultWeights, type Insights, type SourceId, type Weights } from "@travel/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SourceRows } from "@/components/SourceRows";
import { canCurate, useMe } from "@/components/useMe";
import { api } from "@/lib/api";

interface Config {
  weights: Weights;
  blocked: SourceId[];
  alwaysFeature: string;
  neverRecommend: string;
}
interface Prefs {
  useCustom: boolean;
  weights: Weights;
  blocked: SourceId[];
}
type Msg = { text: string; err?: boolean } | null;

export default function SourcesPage() {
  const me = useMe();
  const curator = canCurate(me?.role);
  const [mode, setMode] = useState<"mine" | "app">("mine");
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ useCustom: false, weights: defaultWeights(), blocked: [] });
  const [insights, setInsights] = useState<Insights | null>(null);
  const [myMsg, setMyMsg] = useState<Msg>(null);
  const [appMsg, setAppMsg] = useState<Msg>(null);

  useEffect(() => {
    api<{ config: Config }>("/api/config").then(({ config }) => {
      setConfig(config);
      setDraft(config);
      setPrefs((p) => (p.useCustom ? p : { ...p, weights: config.weights }));
    });
  }, []);
  useEffect(() => {
    if (!me?.user) return;
    api<{ prefs: Prefs | null }>("/api/prefs").then(({ prefs }) => prefs && setPrefs(prefs));
  }, [me?.user]);
  useEffect(() => {
    if (curator && mode === "app") api<{ insights: Insights }>("/api/insights").then((r) => setInsights(r.insights)).catch(() => {});
  }, [curator, mode]);

  async function saveMine() {
    if (!me?.user) return setMyMsg({ text: "Sign in to keep your mix." });
    setMyMsg({ text: "Saving…" });
    try {
      await api("/api/prefs", { method: "PUT", json: prefs });
      setMyMsg({ text: "Saved. Your next trips use this mix." });
    } catch (e) {
      setMyMsg({ text: (e as Error).message, err: true });
    }
  }
  async function saveApp() {
    if (!draft) return;
    setAppMsg({ text: "Saving…" });
    try {
      await api("/api/config", { method: "PUT", json: draft });
      setConfig(draft);
      setAppMsg({ text: "Saved. New trips start from these defaults." });
    } catch (e) {
      setAppMsg({ text: (e as Error).message, err: true });
    }
  }

  if (!config || !draft) return <span className="thinking"><span className="dot" />Loading sources…</span>;

  const appLocked = config.blocked;
  const shownMine = prefs.useCustom ? prefs : { ...prefs, weights: config.weights, blocked: [] };

  return (
    <>
      <div className="card">
        <div className="head">
          <h1>Sources</h1>
          <p className="lede">Choose how heavily trips lean on each kind of source. Every stop is tagged with the source it came from.</p>
        </div>
        <div className="seg" role="tablist" aria-label="Which settings">
          <button role="tab" aria-selected={mode === "mine"} onClick={() => setMode("mine")}>
            My mix
          </button>
          <button role="tab" aria-selected={mode === "app"} onClick={() => setMode("app")}>
            App defaults
          </button>
        </div>

        {mode === "mine" ? (
          <div className="stack">
            {me && !me.user && (
              <p className="note">
                <Link href="/login?next=/sources">Sign in</Link> to set your own mix.
              </p>
            )}
            <label className="switch" htmlFor="use-custom">
              <div>
                <b>Use my own mix</b>
                <span>{prefs.useCustom ? "On: your trips use the weights below." : "Off: your trips follow the app's defaults."}</span>
              </div>
              <input
                id="use-custom"
                type="checkbox"
                checked={prefs.useCustom}
                disabled={!me?.user}
                onChange={(e) => setPrefs({ ...prefs, useCustom: e.target.checked, weights: prefs.useCustom ? prefs.weights : { ...config.weights, ...prefs.weights } })}
              />
            </label>
            <SourceRows
              weights={shownMine.weights}
              blocked={shownMine.blocked}
              locked={appLocked}
              editable={prefs.useCustom}
              inactive={!prefs.useCustom}
              onChange={(n) => {
                setPrefs({ ...prefs, ...n });
                setMyMsg({ text: "Unsaved changes" });
              }}
            />
            <div className="row">
              <button className="btn" onClick={saveMine} disabled={!me?.user}>
                Save my mix
              </button>
              <button className="btn ghost" disabled={!prefs.useCustom} onClick={() => { setPrefs({ useCustom: false, weights: config.weights, blocked: [] }); setMyMsg({ text: "Unsaved changes" }); }}>
                Reset to defaults
              </button>
            </div>
            <p className={`status${myMsg?.err ? " err" : ""}`} role="status">{myMsg?.text}</p>
          </div>
        ) : (
          <div className="stack">
            <p className="note">
              {curator
                ? "These are the defaults every traveler starts from. Sources you block here stay blocked for everyone."
                : "Only curators can change these. You're seeing the defaults every traveler starts from."}
            </p>
            <SourceRows
              weights={draft.weights}
              blocked={draft.blocked}
              editable={curator}
              onChange={(n) => {
                setDraft({ ...draft, ...n });
                setAppMsg({ text: "Unsaved changes" });
              }}
            />
            <div className="field">
              <label className="label" htmlFor="always">Always feature</label>
              <textarea id="always" disabled={!curator} value={draft.alwaysFeature} placeholder="One per line: a partner host, a favorite spot, a neighborhood" onChange={(e) => setDraft({ ...draft, alwaysFeature: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="never">Never recommend</label>
              <textarea id="never" disabled={!curator} value={draft.neverRecommend} placeholder="One per line: chains, tourist traps" onChange={(e) => setDraft({ ...draft, neverRecommend: e.target.value })} />
            </div>
            {curator && <button className="btn" onClick={saveApp}>Save app defaults</button>}
            <p className={`status${appMsg?.err ? " err" : ""}`} role="status">{appMsg?.text}</p>
          </div>
        )}
      </div>

      {curator && mode === "app" && (
        <div className="card">
          <div className="head">
            <span className="pill">Curators only</span>
            <h2>What travelers rated</h2>
            <p className="lede">Anonymous ratings: trip stars, saves, and thumbs on stops and hotels, grouped by the source behind each pick.</p>
          </div>
          {!insights ? (
            <span className="thinking"><span className="dot" />Loading ratings…</span>
          ) : !insights.tripsWithFeedback ? (
            <div className="empty">
              <b>No ratings yet</b>
              <span className="meta">As travelers rate trips, this fills in by source and suggests new default weights.</span>
            </div>
          ) : (
            <InsightsView
              insights={insights}
              draft={draft}
              onApply={(weights) => {
                setDraft({ ...draft, weights });
                setAppMsg({ text: "Suggested weights applied. Review them above, then save." });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

function InsightsView({ insights, draft, onApply }: { insights: Insights; draft: Config; onApply: (w: Weights) => void }) {
  const rows = insights.sources.filter((s) => s.stopsRated || s.avgStars != null);
  const changes = rows.filter((r) => r.suggested != null && r.suggested !== (draft.weights[r.id] ?? r.current));
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><b>{insights.tripsRated}</b><span>trips rated</span></div>
        <div className="kpi"><b>{insights.avgStars != null ? insights.avgStars.toFixed(1) : "–"}</b><span>avg stars</span></div>
        <div className="kpi"><b>{insights.saved}</b><span>trips saved</span></div>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Source</th><th>Picks rated</th><th>Thumbs up</th><th>Avg trip ★</th><th>Weight</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cur = draft.weights[r.id] ?? r.current;
              return (
                <tr key={r.id}>
                  <td><span className="src"><i style={{ background: `var(--s-${r.id})` }} />{SOURCE_BY_ID[r.id].name}</span></td>
                  <td>{r.stopsRated}</td>
                  <td>{r.upRate == null ? "–" : <span className="up">{Math.round(r.upRate * 100)}%</span>}</td>
                  <td>{r.avgStars == null ? "–" : r.avgStars.toFixed(1)}</td>
                  <td>
                    {r.suggested == null || r.suggested === cur ? (
                      <span className="sugg">{cur}</span>
                    ) : (
                      <span className={`sugg ${r.suggested > cur ? "raise" : "lower"}`}>{cur} to {r.suggested}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!!insights.hotelStyles.length && (
        <div className="field">
          <span className="label">Hotel picks by style</span>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Style</th><th>Hotels rated</th><th>Thumbs up</th></tr></thead>
              <tbody>
                {insights.hotelStyles.map((h) => (
                  <tr key={h.style}><td>{h.style}</td><td>{h.rated}</td><td><span className="up">{Math.round(h.upRate * 100)}%</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="hint">Suggestions appear once a source has at least 5 rated picks. They blend thumbs-up rate with how well trips leaning on that source were rated.</p>
      {!!changes.length && (
        <button
          className="btn ghost"
          style={{ alignSelf: "flex-start" }}
          onClick={() => onApply({ ...draft.weights, ...Object.fromEntries(changes.map((c) => [c.id, c.suggested!])) })}
        >
          Apply suggested weights
        </button>
      )}
    </div>
  );
}
