import React from "react";

/** Read-only star display; supports fractional averages (rounded to half stars). */
export function Stars({ value, size = "text-base", label }: { value: number; size?: string; label: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span role="img" aria-label={label} className={`inline-flex ${size} leading-none`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = rounded >= n ? "full" : rounded >= n - 0.5 ? "half" : "empty";
        return (
          <span key={n} aria-hidden="true" className="relative inline-block text-soil-200">
            ★
            {fill !== "empty" && (
              <span className="absolute inset-0 overflow-hidden text-ember-400" style={{ width: fill === "half" ? "50%" : "100%" }}>
                ★
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Accessible 1–5 input implemented as a radio group. */
export function StarInput({
  value,
  onChange,
  labelFor,
  name,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  labelFor: (n: number) => string;
  name: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={`cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            disabled={disabled}
            onChange={() => onChange(n)}
            className="sr-only peer"
          />
          <span
            aria-hidden="true"
            className={`flex items-center justify-center w-10 h-10 text-2xl rounded-md peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-ember-400 ${
              n <= value ? "text-ember-400" : "text-soil-200"
            }`}
          >
            ★
          </span>
          <span className="sr-only">{labelFor(n)}</span>
        </label>
      ))}
    </div>
  );
}
