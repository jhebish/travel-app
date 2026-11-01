"use client";

interface Option<T extends string> {
  value: T;
  label?: string;
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (T | Option<T>)[];
  value: T[];
  onChange: (v: T[]) => void;
  label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : { label: o.value, ...o };
        const on = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== opt.value) : [...value, opt.value])}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function SingleChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (T | Option<T>)[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : { label: o.value, ...o };
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            className="chip"
            aria-checked={value === opt.value}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
