"use client";
import { SOURCES, type SourceId, type Weights } from "@travel/core";

export function SourceRows({
  weights,
  blocked,
  locked = [],
  editable,
  inactive,
  onChange,
}: {
  weights: Weights;
  blocked: SourceId[];
  locked?: SourceId[];
  editable: boolean;
  inactive?: boolean;
  onChange: (next: { weights: Weights; blocked: SourceId[] }) => void;
}) {
  return (
    <div className={`srclist${inactive ? " inactive" : ""}`}>
      {SOURCES.map((s) => {
        const isLocked = locked.includes(s.id);
        const isBlocked = isLocked || blocked.includes(s.id);
        const w = isLocked ? 0 : (weights[s.id] ?? s.defaultWeight);
        return (
          <div key={s.id} className={`srcrow${isBlocked ? " blocked" : ""}`}>
            <div className="srcname">
              <i style={{ background: `var(--s-${s.id})` }} />
              {s.name}
            </div>
            {isLocked ? (
              <span className="locked">Blocked by the app</span>
            ) : (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={isBlocked}
                  disabled={!editable}
                  onChange={(e) =>
                    onChange({
                      weights,
                      blocked: e.target.checked ? [...new Set([...blocked, s.id])] : blocked.filter((b) => b !== s.id),
                    })
                  }
                />{" "}
                Block
              </label>
            )}
            <p className="srcdesc">{s.description}</p>
            <div className="weight">
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={w}
                disabled={!editable || isLocked}
                aria-label={`Weight for ${s.name}`}
                onChange={(e) => onChange({ weights: { ...weights, [s.id]: Number(e.target.value) }, blocked })}
              />
              <output>{w}/10</output>
            </div>
          </div>
        );
      })}
    </div>
  );
}
