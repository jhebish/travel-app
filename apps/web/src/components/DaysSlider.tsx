"use client";
import { useId } from "react";

/** "How many days?" A big, thumb-friendly slider; the itinerary below follows it. */
export function DaysSlider({ value, min, max, onChange, note }: { value: number; min: number; max: number; onChange: (n: number) => void; note?: React.ReactNode }) {
  const id = useId();
  if (max <= min) return null;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="days-slider">
      <div className="days-slider-top">
        <label className="label" htmlFor={id}>
          How many days?
        </label>
        <output htmlFor={id} className="days-value">
          {value} {value === 1 ? "day" : "days"}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={`${value} ${value === 1 ? "day" : "days"}`}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="days-ticks" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {note && <p className="hint days-note">{note}</p>}
    </div>
  );
}
