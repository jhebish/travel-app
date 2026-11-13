"use client";
import { cityCoins, type CityCoin, type CoinEmblem } from "@travel/core";
import Link from "next/link";
import { useMemo, useState } from "react";

/** What each coin carries on its face: line drawings on a 24px grid, in the ink of the coin. */
const EMBLEMS: Record<CoinEmblem, JSX.Element> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8"/>
      <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>
    </>
  ),
  star: (
    <>
      <path d="M12 3L13.65 8.03L18.36 5.64L15.97 10.35L21 12L15.97 13.65L18.36 18.36L13.65 15.97L12 21L10.35 15.97L5.64 18.36L8.03 13.65L3 12L8.03 10.35L5.64 5.64L10.35 8.03Z"/>
      <circle cx="12" cy="12" r="1.3"/>
    </>
  ),
  olive: (
    <>
      <path d="M6.5 20L17.5 4"/>
      <ellipse cx="11.66" cy="15.87" rx="3.1" ry="1.45" transform="rotate(-17.5 11.66 15.87)"/>
      <ellipse cx="10.93" cy="10.19" rx="3.1" ry="1.45" transform="rotate(-93.5 10.93 10.19)"/>
      <ellipse cx="16.5" cy="8.83" rx="3.1" ry="1.45" transform="rotate(-17.5 16.5 8.83)"/>
      <ellipse cx="15.77" cy="3.15" rx="3.1" ry="1.45" transform="rotate(-93.5 15.77 3.15)"/>
      <circle cx="17.5" cy="4" r="0.4"/>
    </>
  ),
  amphora: (
    <>
      <path d="M9.2 3.5h5.6M10.2 3.5v2.2c0 1.3-3.4 3-3.4 7.3 0 4 2.6 6.3 5.2 7.5 2.6-1.2 5.2-3.5 5.2-7.5 0-4.3-3.4-6-3.4-7.3V3.5"/>
      <path d="M10 6.2C7.3 5.8 6 8 7.3 10.2M14 6.2C16.7 5.8 18 8 16.7 10.2M10.2 21h3.6M8.2 11.5h7.6"/>
    </>
  ),
  ship: (
    <>
      <path d="M3 14.5h18c-.8 3.8-4 5.5-9 5.5s-8.2-1.7-9-5.5z"/>
      <path d="M11 14.5V3.5M11 4.5c4.5 1.2 6.8 4 7.5 8h-7.5M11 6.5c-2.5 1.2-4 3.2-4.5 6h4.5"/>
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="5" r="2"/>
      <path d="M12 7v13.5M8.5 10.8h7M4.5 13.5c.3 4.3 3.3 7 7.5 7s7.2-2.7 7.5-7M4.5 13.5l-1 2.6M4.5 13.5l2.4 1.2M19.5 13.5l1 2.6M19.5 13.5l-2.4 1.2"/>
    </>
  ),
  trident: (
    <>
      <path d="M12 21.5V3M5.5 4v5.5c0 2.7 2.7 4.3 6.5 4.3s6.5-1.6 6.5-4.3V4M12 3l-1.7 2.4M12 3l1.7 2.4M5.5 4 4 6.2M5.5 4 7 6.2M18.5 4 17 6.2M18.5 4 20 6.2M9.5 17h5"/>
    </>
  ),
  wave: (
    <>
      <path transform="translate(1.4 2.5) scale(0.757)" d="M0 11 C6 11 8 9 8 6 C8 3 10.5 1 14 1 C17.5 1 19.5 3 19.5 5.2 C19.5 8 22.5 11 28 11 M19.5 5.2 C19.5 7.2 18 8.2 16.4 8.2 C15 8.2 14.2 7.3 14.2 6.2 C14.2 5.2 15 4.6 15.9 4.6"/>
      <path transform="translate(1.4 11.5) scale(0.757)" d="M0 11 C6 11 8 9 8 6 C8 3 10.5 1 14 1 C17.5 1 19.5 3 19.5 5.2 C19.5 8 22.5 11 28 11 M19.5 5.2 C19.5 7.2 18 8.2 16.4 8.2 C15 8.2 14.2 7.3 14.2 6.2 C14.2 5.2 15 4.6 15.9 4.6"/>
    </>
  ),
  lyre: (
    <>
      <path d="M8.5 20.5C4.8 16.5 4.6 9.5 7 4M15.5 20.5C19.2 16.5 19.4 9.5 17 4M5.8 7h12.4M8.5 20.5h7M10.2 7v13.5M12 7v13.5M13.8 7v13.5"/>
    </>
  ),
  crescent: (
    <>
      <path d="M18.5 14.2A7.8 7.8 0 1 1 9.8 5.5a6.1 6.1 0 0 0 8.7 8.7z"/>
      <path d="M17.5 4.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z"/>
    </>
  ),
};

const METAL_NOTE = { bronze: "a bronze coin", silver: "a silver coin", gold: "a gold coin" } as const;

const when = (c: CityCoin) => (c.firstYear == null ? "" : c.firstYear === c.lastYear ? String(c.lastYear) : `${c.firstYear}–${c.lastYear}`);

function Coin({ coin }: { coin: CityCoin }) {
  return (
    <span className={`coin ${coin.metal}`} style={{ "--turn": `${coin.turn}deg` } as React.CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {EMBLEMS[coin.emblem]}
      </svg>
      <span className="coin-legend">{coin.legend}</span>
    </span>
  );
}

/**
 * The places someone has been as a collection of coins: every Greek city struck its own, so every
 * city here has one. Bronze for a first visit, silver for a second, gold from the third. Each coin
 * opens the most recent visit.
 */
export function CoinCollection({
  places,
  first = 12,
}: {
  places: { id: string; city: string; countryCode: string; year: number | null; month?: number | null }[];
  /** How many coins show before "Show all". */
  first?: number;
}) {
  const coins = useMemo(() => cityCoins(places), [places]);
  const [all, setAll] = useState(false);
  if (coins.length === 0) return null;
  // A few over the limit isn't worth a button.
  const fold = coins.length > first + 3;
  const shown = all || !fold ? coins : coins.slice(0, first);
  return (
    <div className="coinbox">
      <ul className="coins" aria-label="City coins">
        {shown.map((c) => {
          const years = when(c);
          return (
            <li key={c.key}>
              <Link href={`/p/${c.latestId}`} className="coin-link" title={`${c.city}: ${c.visits > 1 ? `${c.visits} visits, ` : ""}${METAL_NOTE[c.metal]}`}>
                <Coin coin={c} />
                <span className="coin-name">{c.city}</span>
                <span className="coin-when">
                  {years}
                  {c.visits > 1 ? `${years ? " · " : ""}${c.visits}×` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {fold && (
        <button type="button" className="linkbtn" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${coins.length} coins`}
        </button>
      )}
    </div>
  );
}
