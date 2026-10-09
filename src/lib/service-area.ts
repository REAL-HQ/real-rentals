// Service Area / Mileage Limit: a structured choice that produces the exact
// text printed in the agreement's "Service Area / Mileage Limit" row.
// Client-safe. Nothing is ever defaulted: an empty choice stays blank and
// blocks template approval until the Owner picks one explicitly.

export type ServiceArea =
  | { mode: "unset" }
  | { mode: "radius"; miles: number; center: string; region: string }
  | { mode: "region"; region: string; weeklyMiles: number | null }
  | { mode: "unlimited"; region: string };

export function composeServiceArea(a: ServiceArea): string {
  switch (a.mode) {
    case "unset": return "";
    case "radius": {
      if (!(a.miles > 0) || !a.center.trim()) return "";
      const base = `${a.miles}-mile radius of ${a.center.trim()}`;
      return a.region.trim() ? `${base}; ${a.region.trim()} only` : base;
    }
    case "region": {
      if (!a.region.trim()) return "";
      const miles = a.weeklyMiles && a.weeklyMiles > 0 ? `; ${a.weeklyMiles.toLocaleString("en-US")} miles per week` : "";
      return `${a.region.trim()} only${miles}`;
    }
    case "unlimited":
      return a.region.trim() ? `Unlimited mileage; ${a.region.trim()} only` : "Unlimited mileage";
  }
}

/** Best-effort read of a saved value back into the structured form ("unset" when unrecognized). */
export function parseServiceArea(text: string): ServiceArea | { mode: "custom"; text: string } {
  const t = (text ?? "").trim();
  if (!t) return { mode: "unset" };
  if (/[\[\]]/.test(t)) return { mode: "custom", text: t }; // bracketed open items stay as written
  let m = t.match(/^(\d+)-mile radius of (.+?)(?:; (.+) only)?$/);
  if (m) return { mode: "radius", miles: Number(m[1]), center: m[2], region: m[3] ?? "" };
  m = t.match(/^Unlimited mileage(?:; (.+) only)?$/);
  if (m) return { mode: "unlimited", region: m[1] ?? "" };
  m = t.match(/^(.+?) only(?:; ([\d,]+) miles per week)?$/);
  if (m) return { mode: "region", region: m[1], weeklyMiles: m[2] ? Number(m[2].replace(/,/g, "")) : null };
  return { mode: "custom", text: t };
}
