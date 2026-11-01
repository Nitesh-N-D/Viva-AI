import React, { useId } from "react";

const inputClasses =
  "w-full min-h-[48px] rounded-tile border border-soil-200 bg-white px-3 text-base text-soil-900 focus:border-leaf-600 focus:outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ember-400 disabled:bg-soil-50";

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
}

export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-soil-700">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-xs text-soil-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | null;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectField({ label, hint, error, options, placeholder, ...rest }: SelectProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select id={id} aria-describedby={describedBy} aria-invalid={invalid} className={inputClasses} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | null;
  suffix?: string;
}

export function InputField({ label, hint, error, suffix, ...rest }: InputProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className={`${inputClasses} ${suffix ? "pr-14" : ""}`} {...rest} />
          {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-soil-500 pointer-events-none">{suffix}</span>}
        </div>
      )}
    </FieldShell>
  );
}

interface TextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextAreaField({ label, hint, error, ...rest }: TextAreaProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className={`${inputClasses} py-2 min-h-[88px]`} {...rest} />
      )}
    </FieldShell>
  );
}

/** Segmented control (radio group styled as buttons). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold text-soil-700 mb-1">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input type="radio" name={name} className="sr-only peer" checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="inline-flex items-center min-h-[44px] px-3 rounded-tile border text-sm font-semibold border-soil-200 bg-white text-soil-700 peer-checked:bg-leaf-600 peer-checked:text-white peer-checked:border-leaf-600 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-ember-400">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
