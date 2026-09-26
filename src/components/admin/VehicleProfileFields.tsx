import type { ReactNode } from "react";
import { MicroLabel } from "./ui";

// The pieces the vehicle profile reads and writes with.
//
// The record is meant to be read. A row shows a label and a value and nothing
// else — no boxes, no chrome, no affordance suggesting you can type into it.
// Editing is a separate act that happens in a drawer, so a page you opened to
// check a plate number cannot become a page you accidentally changed.

/** A field that has never been filled in reads as "—", never as blank. */
export function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-[#F4F4F6] last:border-0">
      <div className="w-[42%] shrink-0 text-[12px] text-[#9A9AA3]">{label}</div>
      <div
        className={`min-w-0 flex-1 text-[13px] ${empty ? "text-[#C4C4CB]" : "text-[#111114]"} ${mono ? "font-mono text-[12px]" : ""} break-words`}
      >
        {empty ? "—" : value}
      </div>
    </div>
  );
}

/** Two columns on a wide screen, one on a phone. */
export function TwoCol({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0">{children}</div>;
}

// ---- drawer inputs -------------------------------------------------------

const inputCls =
  "w-full h-9 rounded-md border border-[#EDEDF0] bg-white px-2.5 text-[13px] text-[#111114] outline-none focus:border-[#D03020] transition-colors";

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block">
      <MicroLabel className="mb-1.5">{label}</MicroLabel>
      {children}
      {error ? (
        <div className="mt-1 text-[11px] text-[#D03020]">{error}</div>
      ) : hint ? (
        <div className="mt-1 text-[11px] text-[#9A9AA3]">{hint}</div>
      ) : null}
    </label>
  );
}

export function Text({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} ${mono ? "font-mono tracking-tight" : ""} ${error ? "border-[#D03020]" : ""}`}
      />
    </Field>
  );
}

export function Area({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-md border border-[#EDEDF0] bg-white px-2.5 py-2 text-[13px] text-[#111114] outline-none focus:border-[#D03020] transition-colors resize-y"
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint?: string;
  error?: string;
  suffix?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={`${inputCls} ${suffix ? "pr-10" : ""} ${error ? "border-[#D03020]" : ""}`}
        />
        {suffix && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#9A9AA3] pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

export function DateInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </Field>
  );
}

export function Choice({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
