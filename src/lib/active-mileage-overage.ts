// Mileage overage for an active rental.
// Driven miles are the last recorded odometer minus the start odometer.
// The allowance is the text on that rental's agreement. A missing start,
// last reading, or allowance stays Unknown. Nothing here is invented.

export type OverageState = "over" | "within" | "unlimited" | "unknown";

export type MileageOverage = {
  rentalId: string;
  state: OverageState;
  label: string;
  driven: number | null;
  allowance: number | null;
};

function wholeMiles(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 2_000_000) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isInteger(n) && n >= 0 && n < 2_000_000) return n;
  }
  return null;
}

function calendarDays(start: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || today < start) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

/** Miles allowed through today, or unlimited. Null miles with unlimited false means the text is not an allowance. */
export function allowanceMiles(
  text: string | null | undefined,
  startDate: string | null,
  today: string,
): { miles: number | null; unlimited: boolean } {
  const raw = String(text ?? "").trim();
  if (!raw || raw.includes("[[")) return { miles: null, unlimited: false };
  if (/unlimited/i.test(raw)) return { miles: null, unlimited: true };
  const match = raw.match(/(\d{1,3}(?:,\d{3})+|\d+)/);
  if (!match) return { miles: null, unlimited: false };
  const miles = Number(match[1].replace(/,/g, ""));
  if (!Number.isInteger(miles) || miles < 0) return { miles: null, unlimited: false };
  if (/per week|\/\s*week|a week/i.test(raw)) {
    const days = startDate ? calendarDays(startDate, today) : null;
    if (days == null) return { miles: null, unlimited: false };
    const weeks = Math.max(1, Math.ceil(days / 7));
    return { miles: miles * weeks, unlimited: false };
  }
  return { miles, unlimited: false };
}

/** The allowance printed on an agreement, or null when the contract does not state one. */
export function allowanceTextFromAgreement(body: string | null | undefined): string | null {
  if (!body) return null;
  const rendered = body.match(/Mileage Limit\s*\|\s*[^|\n]*;\s*([^|\n]+)/i);
  if (rendered) {
    const text = rendered[1].trim();
    if (text && !text.includes("[[")) return text;
  }
  const term = body.match(/mileage_allowance:\s*([^\n]+)/i);
  if (term) {
    const text = term[1].trim();
    if (text && !text.includes("[[")) return text;
  }
  return null;
}

export function estimateMileageOverage(input: {
  rentalId: string;
  startMiles: unknown;
  lastMiles: unknown;
  allowanceText: string | null;
  startDate: string | null;
  today: string;
}): MileageOverage {
  const unknown = (): MileageOverage => ({
    rentalId: input.rentalId,
    state: "unknown",
    label: "Unknown",
    driven: null,
    allowance: null,
  });
  const start = wholeMiles(input.startMiles);
  const last = wholeMiles(input.lastMiles);
  if (start == null || last == null || last < start) return unknown();
  const driven = last - start;
  const allowance = allowanceMiles(input.allowanceText, input.startDate, input.today);
  if (allowance.unlimited) {
    return { rentalId: input.rentalId, state: "unlimited", label: "Unlimited", driven, allowance: null };
  }
  if (allowance.miles == null) return unknown();
  const over = driven - allowance.miles;
  if (over > 0) {
    return {
      rentalId: input.rentalId,
      state: "over",
      label: over === 1 ? "1 Mile Over" : `${over.toLocaleString("en-US")} Miles Over`,
      driven,
      allowance: allowance.miles,
    };
  }
  return { rentalId: input.rentalId, state: "within", label: "Within Allowance", driven, allowance: allowance.miles };
}
