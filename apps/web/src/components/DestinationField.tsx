"use client";
import {
  DESTINATION_BY_KEY,
  REASON_LABELS,
  foldPlace,
  localSuggestions,
  mergeSuggestions,
  type PastTrip,
  type PlaceSuggestion,
} from "@travel/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * The trip planner's destination box, guessing where you want to go as you type: Pylos places,
 * your For you picks and places you've been come up instantly, then cities, regions and countries
 * from the map. Arrow keys move through the list, Enter picks, Escape closes it.
 */
export function DestinationField({
  id,
  value,
  mode,
  placeholder,
  signedIn,
  onChange,
  onPick,
}: {
  id: string;
  value: string;
  mode: "single" | "multi";
  placeholder: string;
  signedIn: boolean;
  onChange: (text: string) => void;
  onPick: (s: PlaceSuggestion) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [forYou, setForYou] = useState<string[]>([]);
  const [been, setBeen] = useState<{ city: string; countryCode: string }[]>([]);
  const [remote, setRemote] = useState<PlaceSuggestion[]>([]);
  const asked = useRef(false);
  const listId = `${id}-suggestions`;

  // What to guess from, fetched the first time the box is used.
  useEffect(() => {
    if (!focused || asked.current || !signedIn) return;
    asked.current = true;
    api<{ picks: { key: string }[]; member: boolean }>("/api/browse/foryou")
      .then((r) => r.member && setForYou(r.picks.map((p) => p.key)))
      .catch(() => {});
    api<{ places: PastTrip[] }>("/api/community/places")
      .then((r) => setBeen(r.places.map((p) => ({ city: p.city, countryCode: p.countryCode }))))
      .catch(() => {});
  }, [focused, signedIn]);

  // The map's suggestions, a moment after typing stops.
  const q = value.trim();
  useEffect(() => {
    if (foldPlace(q).length < 2 || q === picked) return;
    let alive = true;
    const timer = setTimeout(() => {
      api<{ suggestions: PlaceSuggestion[] }>(`/api/places/suggest?${new URLSearchParams({ q })}`)
        .then((r) => alive && setRemote(r.suggestions))
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, picked]);

  const list = useMemo(() => {
    if (!q) return [];
    const first = foldPlace(q).split(" ")[0] ?? "";
    return mergeSuggestions(
      localSuggestions(q, { mode, forYou, been, max: 6 }),
      remote.filter((s) => foldPlace(s.label).includes(first)),
      6,
    );
  }, [q, mode, forYou, been, remote]);
  const open = focused && picked !== value && list.length > 0;
  useEffect(() => setActive(-1), [q]);

  function choose(s: PlaceSuggestion) {
    setPicked(s.label);
    setActive(-1);
    onPick(s);
  }

  return (
    <div className="dest-field">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setPicked(null);
          onChange(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % list.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? list.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            // Picks the place instead of sending the form.
            e.preventDefault();
            choose(list[active]!);
          } else if (e.key === "Escape") {
            setPicked(value);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="suggest-list" aria-label="Suggested destinations">
          {list.map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Before the box loses focus, so the pick lands.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>
                <b>{s.name}</b>
                {s.sub && <small>{s.sub}</small>}
              </span>
              {s.reason && s.reason !== "featured" && <em className={`suggest-reason ${s.reason}`}>{REASON_LABELS[s.reason]}</em>}
            </li>
          ))}
        </ul>
      )}
      {/* Tells screen readers that suggestions are open, and how to move through them. */}
      <span className="sr-only" aria-live="polite">
        {open ? `${list.length} suggestions. Use the arrow keys to choose one.` : ""}
      </span>
      {forYou.length > 0 && !q && focused && (
        <p className="hint suggest-picks">
          For you:{" "}
          {forYou
            .map((k) => DESTINATION_BY_KEY[k])
            .filter((d): d is NonNullable<typeof d> => !!d)
            .slice(0, 3)
            .map((d, i) => (
              <span key={d.key}>
                {i ? ", " : ""}
                <button
                  type="button"
                  className="linkbtn"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose({ label: d.kind === "region" ? d.name : `${d.name}, ${d.country}`, name: d.name, sub: d.country, kind: d.kind === "region" ? "region" : "city", reason: "for-you", key: d.key });
                  }}
                >
                  {d.name}
                </button>
              </span>
            ))}
        </p>
      )}
    </div>
  );
}
