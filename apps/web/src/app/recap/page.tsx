"use client";
import { SIGNAL_KIND_LABELS, countryName, flag, type YearRecap } from "@travel/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { IconShare } from "@/components/icons";
import { useMe } from "@/components/useMe";
import { api, ApiError } from "@/lib/api";

interface RecapDTO {
  recap: YearRecap;
  personality: string | null;
  years: number[];
}

const thisYear = () => new Date().getFullYear();
const yearFrom = (raw: string | null) => {
  const y = Number(raw);
  return Number.isInteger(y) && y >= 1950 && y <= thisYear() + 1 ? y : thisYear();
};

/** Your year in travel: only ever the signed-in person's own trips, and a story picture to share. */
function Recap() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const year = yearFrom(params.get("year"));
  const [data, setData] = useState<RecapDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [story, setStory] = useState<{ year: number; blob: Blob; url: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null);

  useEffect(() => {
    if (!me?.user) return;
    setData(null);
    setErr(null);
    setNote(null);
    api<RecapDTO>(`/api/recap?year=${year}`)
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "We couldn't load your year. Try again."));
  }, [me?.user, year]);

  // Draw the picture as soon as there's a year to show, so Share can open the share sheet at once
  // (browsers only allow it straight after a tap).
  useEffect(() => {
    if (!data?.recap.trips) return;
    let alive = true;
    let url: string | null = null;
    loadStory(year)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setStory({ year, blob, url });
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (!url) return;
      const gone = url;
      URL.revokeObjectURL(gone);
      setStory((s) => (s?.url === gone ? null : s));
    };
  }, [data, year]);

  async function share() {
    setSharing(true);
    setNote(null);
    try {
      const blob = story?.year === year ? story.blob : await loadStory(year);
      const file = new File([blob], `pylos-${year}-in-travel.png`, { type: "image/png" });
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `My ${year} in travel` });
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return; // they closed the share sheet
          // Not allowed here (or any more): save it instead.
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNote({ text: "Saved the picture. Add it to your story from your photos." });
    } catch {
      setNote({ text: "We couldn't make the picture just now. Try again.", err: true });
    } finally {
      setSharing(false);
    }
  }

  if (me && !me.user) {
    return (
      <div className="card empty">
        <b>Sign in to see your year in travel</b>
        <Link href={`/login?next=/recap?year=${year}`}>Sign in</Link>
      </div>
    );
  }
  if (err)
    return (
      <div className="card empty">
        <b>{err}</b>
        <Link href="/profile">Back to You</Link>
      </div>
    );
  if (!data) return <div className="card"><p className="hint">Loading…</p></div>;

  const r = data.recap;
  const years = [...new Set([year, ...data.years])].sort((a, b) => b - a);
  const tiles: [string, string][] = [
    [String(r.trips), r.trips === 1 ? "trip" : "trips"],
    [String(r.cities), r.cities === 1 ? "city" : "cities"],
    [String(r.countries), r.countries === 1 ? "country" : "countries"],
    [r.daysAway ? `${r.daysAway}${r.daysUnknown ? "+" : ""}` : "–", r.daysAway === 1 && !r.daysUnknown ? "day away" : "days away"],
  ];

  return (
    <div className="stack recap" style={{ gap: 22 }}>
      <div className="head">
        <span className="eyebrow">Your year in travel</span>
        <h1>Your {year} in travel</h1>
        {data.personality && <p className="lede">{data.personality}</p>}
      </div>

      {years.length > 1 && (
        <div className="chips" role="group" aria-label="Year">
          {years.map((y) => (
            <button key={y} type="button" className="chip" aria-pressed={y === year} onClick={() => router.replace(`/recap?year=${y}`, { scroll: false })}>
              {y}
            </button>
          ))}
        </div>
      )}

      {r.trips === 0 ? (
        <section className="card empty">
          <b>No trips logged for {year} yet</b>
          <span className="hint">Log where you went and what you loved, and your year shows up here, ready to share.</span>
          <Link href="/profile">Log a trip</Link>
        </section>
      ) : (
        <>
          <section className="card stack">
            <div className="recap-stats">
              {tiles.map(([n, label]) => (
                <div key={label}>
                  <b className="tabnum">{n}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <dl className="recap-facts">
              {r.topCity && (
                <div>
                  <dt>Top city</dt>
                  <dd>
                    <Link href={`/p/${r.topCity.pastTripId}`}>
                      <span aria-hidden="true">{flag(r.topCity.countryCode)}</span> {r.topCity.city}, {countryName(r.topCity.countryCode)}
                    </Link>
                  </dd>
                </div>
              )}
              {r.topPlace && (
                <div>
                  <dt>Top place</dt>
                  <dd>
                    {r.topPlace.name}
                    <small> {[SIGNAL_KIND_LABELS[r.topPlace.kind], r.topPlace.city].filter(Boolean).join(" · ")}</small>
                  </dd>
                </div>
              )}
              <div>
                <dt>{r.newCountries.length === 1 ? "New country" : "New countries"}</dt>
                <dd>
                  {r.newCountries.length
                    ? r.newCountries.map((c) => (
                        <span key={c} className="place">
                          <span aria-hidden="true">{flag(c)}</span> {countryName(c)}
                        </span>
                      ))
                    : "None this year: places you already knew, and went back to."}
                </dd>
              </div>
            </dl>
          </section>

          <section className="card stack recap-share">
            <div className="head">
              <h2>Share your year</h2>
              <p className="hint">A picture for your story: your counts, your top city and place, and nothing else.</p>
            </div>
            {story?.year === year && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="recap-story" src={story.url} alt={`Your ${year} in travel, as a story picture`} width={270} height={480} />
            )}
            <button type="button" className="btn" disabled={sharing} onClick={share}>
              <IconShare />
              {sharing ? "Making your picture…" : "Share"}
            </button>
            {note && (
              <p className={`status${note.err ? " err" : ""}`} role="status">
                {note.text}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

async function loadStory(year: number): Promise<Blob> {
  const res = await fetch(`/api/recap/story?year=${year}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`story ${res.status}`);
  return res.blob();
}

export default function Page() {
  return (
    <Suspense>
      <Recap />
    </Suspense>
  );
}
