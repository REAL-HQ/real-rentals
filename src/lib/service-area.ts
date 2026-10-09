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

/** Exact control state saved with a draft (not printed) so reopening shows the same mode and inputs. */
export type ServiceAreaConfig = {
  mode: "unset" | "radius" | "region" | "custom" | "none";
  radius: { miles: number; center: string; region: string };
  region: string;
  custom: string;
};
export const EMPTY_AREA_CONFIG: ServiceAreaConfig = { mode: "unset", radius: { miles: 0, center: "", region: "" }, region: "", custom: "" };

export function areaConfigFrom(saved: string | undefined, text: string): ServiceAreaConfig {
  try {
    const c = saved ? JSON.parse(saved) : null;
    if (c && typeof c === "object" && ["unset", "radius", "region", "custom", "none"].includes(c.mode))
      return { ...EMPTY_AREA_CONFIG, ...c, radius: { ...EMPTY_AREA_CONFIG.radius, ...(c.radius ?? {}) } };
  } catch { /* fall back to reading the printed text */ }
  const p = parseServiceArea(text);
  const c = { ...EMPTY_AREA_CONFIG, radius: { ...EMPTY_AREA_CONFIG.radius } };
  if (p.mode === "radius") return { ...c, mode: "radius", radius: { miles: p.miles, center: p.center, region: p.region } };
  if (p.mode === "region") return { ...c, mode: "region", region: p.region };
  if (p.mode === "custom") return { ...c, mode: "custom", custom: p.text };
  return { ...c, mode: p.mode };
}

/** Printed text for the selected mode only; inputs of other modes are kept, never printed. */
export function composeAreaConfig(c: ServiceAreaConfig): string {
  if (c.mode === "radius") return composeServiceArea({ mode: "radius", ...c.radius });
  if (c.mode === "region") return composeServiceArea({ mode: "region", region: c.region });
  if (c.mode === "custom") return c.custom.trim();
  if (c.mode === "none") return composeServiceArea({ mode: "none" });
  return "";
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
