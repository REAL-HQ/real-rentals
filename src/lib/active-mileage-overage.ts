// Mileage overage for an active rental.
// Driven miles are the last recorded odometer minus the start odometer.
// The allowance is the phrase on that rental's agreement, read by the same
// parser the contract uses. A custom phrase, a non-mile unit, a missing
// start, a missing last reading, or a reading that is not the current
// vehicle's valid pickup stays Unknown. Nothing here is invented.
import { parseMileage, type MileagePeriod } from "@/lib/service-area";

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

/**
 * How many allowance periods have opened by today.
 * Weekly is max(1, ceil(elapsed days / 7)): the start date is one week,
 * exactly seven days is still one week, and the eighth day opens the second.
 * A day uses that same rule with a one-day period. A month uses the calendar
 * anniversary the same way (an exact month stays in that count; a later
 * day-of-month opens the next). The whole-rental cap is one period and does
 * not need a date.
 */
function periodsOpen(period: MileagePeriod, startDate: string | null, today: string): number | null {
  if (period === "rental") return 1;
  if (!startDate) return null;
  const days = calendarDays(startDate, today);
  if (days == null) return null;
  if (period === "day") return Math.max(1, days);
  if (period === "week") return Math.max(1, Math.ceil(days / 7));
  const ys = Number(startDate.slice(0, 4));
  const ms = Number(startDate.slice(5, 7));
  const ds = Number(startDate.slice(8, 10));
  const yt = Number(today.slice(0, 4));
  const mt = Number(today.slice(5, 7));
  const dt = Number(today.slice(8, 10));
  let months = (yt - ys) * 12 + (mt - ms);
  if (dt > ds) months += 1;
  return Math.max(1, months);
}

/** Miles allowed through today, or unlimited. Null miles with unlimited false means the text is not an allowance. */
export function allowanceMiles(
  text: string | null | undefined,
  startDate: string | null,
  today: string,
): { miles: number | null; unlimited: boolean } {
  const parsed = parseMileage(String(text ?? ""));
  if (parsed.mode === "unlimited") return { miles: null, unlimited: true };
  if (parsed.mode !== "limited") return { miles: null, unlimited: false };
  if (!Number.isInteger(parsed.miles) || parsed.miles <= 0 || parsed.miles >= 2_000_000) {
    return { miles: null, unlimited: false };
  }
  const periods = periodsOpen(parsed.period, startDate, today);
  if (periods == null) return { miles: null, unlimited: false };
  const miles = parsed.miles * periods;
  if (!Number.isSafeInteger(miles)) return { miles: null, unlimited: false };
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

/** A full contract, or the one allowance phrase already taken out of it. */
export function statedAllowance(text: string | null | undefined): string | null {
  const fromContract = allowanceTextFromAgreement(text);
  if (fromContract) return fromContract;
  const bare = String(text ?? "").trim();
  if (!bare || bare.includes("[[") || /[\n\r]/.test(bare) || bare.length > 80) return null;
  return bare;
}

export function estimateMileageOverage(input: {
  rentalId: string;
  rentalStatus: string | null;
  vehicleId: string | null;
  startMiles: unknown;
  readingStatus: string | null;
  readingVehicleId: string | null;
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
  if (input.rentalStatus !== "active") return unknown();
  if (input.readingStatus !== "valid") return unknown();
  if (!input.vehicleId || input.readingVehicleId !== input.vehicleId) return unknown();
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
