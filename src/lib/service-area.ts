// Service Area (where the renter may drive) and Mileage Allowance (how far)
// are separate contract rules, composed into the exact text printed in the
// agreement. Client-safe. Nothing defaults: an empty choice stays blank and
// blocks template approval until the Owner picks one explicitly.

export type ServiceArea =
  | { mode: "unset" }
  | { mode: "radius"; miles: number; center: string; region: string }
  | { mode: "region"; region: string }
  | { mode: "none" };

export function composeServiceArea(a: ServiceArea): string {
  switch (a.mode) {
    case "unset": return "";
    case "radius": {
      if (!(a.miles > 0) || !a.center.trim()) return "";
      const base = `${a.miles}-mile radius of ${a.center.trim()}`;
      return a.region.trim() ? `${base}; ${a.region.trim()} only` : base;
    }
    case "region": return a.region.trim() ? `${a.region.trim()} only` : "";
    case "none": return "No geographic restriction";
  }
}

/** Read a saved value back into the structured form; anything else stays custom wording, never rewritten. */
export function parseServiceArea(text: string): ServiceArea | { mode: "custom"; text: string } {
  const t = (text ?? "").trim();
  if (!t) return { mode: "unset" };
  if (/[\[\]]/.test(t)) return { mode: "custom", text: t }; // bracketed open items stay as written
  if (t === "No geographic restriction") return { mode: "none" };
  let m = t.match(/^(\d+)-mile radius of (.+?)(?:; (.+) only)?$/);
  if (m) return { mode: "radius", miles: Number(m[1]), center: m[2], region: m[3] ?? "" };
  m = t.match(/^([^;]+?) only$/);
  if (m) return { mode: "region", region: m[1] };
  return { mode: "custom", text: t };
}

export type MileagePeriod = "day" | "week" | "month" | "rental";
export const PERIOD_LABEL: Record<MileagePeriod, string> = { day: "Per Day", week: "Per Week", month: "Per Month", rental: "Per Rental" };
export type Mileage = { mode: "unset" } | { mode: "unlimited" } | { mode: "limited"; miles: number; period: MileagePeriod };

export function composeMileage(m: Mileage): string {
  if (m.mode === "unlimited") return "Unlimited miles";
  if (m.mode === "limited" && m.miles > 0) return `${m.miles.toLocaleString("en-US")} miles per ${m.period}`;
  return "";
}

export function parseMileage(text: string): Mileage | { mode: "custom"; text: string } {
  const t = (text ?? "").trim();
  if (!t) return { mode: "unset" };
  if (t === "Unlimited miles") return { mode: "unlimited" };
  const m = t.match(/^([\d,]+) miles per (day|week|month|rental)$/);
  if (m) return { mode: "limited", miles: Number(m[1].replace(/,/g, "")), period: m[2] as MileagePeriod };
  return { mode: "custom", text: t };
}

/** Excess-mileage fee applies only to a limited allowance; unlimited clears it. */
export function excessFeeFor(mileageText: string, fee: string): string {
  return parseMileage(mileageText).mode === "limited" ? fee : "";
}
