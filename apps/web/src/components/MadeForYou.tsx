"use client";
import { DEMO_CITY, DEMO_TRAVELERS, HOW_PYLOS_LEARNS } from "@travel/core";
import Link from "next/link";
import { useRef, useState } from "react";

/** Where the visitor is with Pylos: no account, learning their taste, or already known. */
export type MadeForYouState = "out" | "learning" | "known";

/**
 * The home page's case for Pylos: other apps give everyone the same list, Pylos plans from what
 * you've already loved. Shown, not told: the same Saturday in Lisbon for three example travelers,
 * each stop with why it was picked for them.
 */
export function MadeForYou({ state }: { state: MadeForYouState }) {
  const [on, setOn] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const t = DEMO_TRAVELERS[on]!;

  // Arrow keys move between the travelers, as in any tab list.
  function onKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (on + step + DEMO_TRAVELERS.length) % DEMO_TRAVELERS.length;
    setOn(next);
    tabs.current[next]?.focus();
  }

  return (
    <section className="made4u" aria-labelledby="made4u-title">
      <div className="made4u-head">
        <span className="eyebrow">Not another top-ten list</span>
        <h2 id="made4u-title">One city, one Saturday, three different trips</h2>
        <p className="lede">
          Most travel apps hand everyone the same list. Pylos learns from the trips you&apos;ve already taken and what you loved on them, then predicts the hotel, the tables and
          the pace you&apos;ll love somewhere new.
        </p>
      </div>

      <div className="made4u-demo">
        <div className="made4u-tabs" role="tablist" aria-label="Example travelers">
          {DEMO_TRAVELERS.map((x, i) => (
            <button
              key={x.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`made4u-tab-${x.key}`}
              aria-selected={i === on}
              aria-controls="made4u-panel"
              tabIndex={i === on ? 0 : -1}
              onClick={() => setOn(i)}
              onKeyDown={onKey}
            >
              <b>{x.name}</b>
              <span>{x.tag}</span>
            </button>
          ))}
        </div>
        <div className="made4u-panel" id="made4u-panel" role="tabpanel" aria-labelledby={`made4u-tab-${t.key}`}>
          <div className="made4u-panel-head">
            <span className="eyebrow">Saturday in {DEMO_CITY}, for {t.name}</span>
            {/* On phones the tabs show only names. */}
            <p className="made4u-tag">{t.tag}</p>
            <p className="made4u-learned">
              <b>What Pylos learned:</b> {t.learned}
            </p>
          </div>
          <ol className="made4u-day">
            {t.stops.map((s) => (
              <li key={s.name} className={s.time === "Stay" ? "stay" : undefined}>
                <span className="made4u-time">{s.time}</span>
                <span className="made4u-stop">
                  <b>{s.name}</b>
                  <span className="made4u-why">
                    <span className="made4u-for">{t.forLabel}</span> {s.why}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="hint made4u-note">Example travelers. Your plan comes from your own trips.</p>
        </div>
      </div>

      <div className="made4u-more">
        <ol className="made4u-steps">
          {HOW_PYLOS_LEARNS.map((s, i) => (
            <li key={s.title}>
              <span className="made4u-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <b>{s.title}</b>
                <span>{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="row">
          {state === "out" ? (
            <>
              <Link className="btn" href="/login?next=/profile">
                Start with a past trip
              </Link>
              <Link className="linkbtn" href="/plan">
                Or plan one now
              </Link>
            </>
          ) : state === "learning" ? (
            <Link className="btn" href="/profile">
              Teach Pylos your taste
            </Link>
          ) : (
            <Link className="btn" href="/profile">
              See your taste profile
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
