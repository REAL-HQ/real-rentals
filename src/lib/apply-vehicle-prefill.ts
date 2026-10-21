/**
 * Preferred vehicle on /apply, read from the existing `vehicle` search key.
 *
 * applications.vehicle_id exists, but savePartialApplication and
 * updateApplicationStep do not accept it, and getApplicationForWizard does
 * not return it. Writing it would be a new applicant write, so the choice
 * stays in this tab's sessionStorage.
 */
export const APPLY_VEHICLE_PREFILL_ENABLED: boolean = false as boolean;

export const PREFERRED_VEHICLE_GAP =
  "applications.vehicle_id exists, but the applicant save and resume paths do not write or return it. The preferred vehicle stays in this tab only.";

/** Explicit public columns. Plate and VIN are not selected. */
export const PUBLIC_APPLY_VEHICLE_COLUMNS = "id,make,model,year,weekly_rate,status" as const;

const SESSION_KEY = "rr.apply.preferred-vehicle";

export type PreferredVehicle = {
  id: string;
  heading: string;
  weeklyRateLabel: string;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Quiet ignore: a missing row, a failed read, or any status other than
 * available becomes null. Only allowlisted fields are copied.
 */
export function presentPreferredVehicle(
  row: Record<string, unknown> | null,
  failed = false,
): PreferredVehicle | null {
  if (failed || !row) return null;
  const id = text(row.id);
  const status = text(row.status);
  if (!id || status !== "available") return null;

  const make = text(row.make) ?? "";
  const model = text(row.model) ?? "";
  const year = typeof row.year === "number" && Number.isFinite(row.year) ? row.year : null;
  const name = [make, model].filter(Boolean).join(" ").trim() || "Vehicle";
  const heading = [year !== null ? String(year) : null, name].filter(Boolean).join(" ");
  const weeklyRateLabel =
    typeof row.weekly_rate === "number" && Number.isFinite(row.weekly_rate)
      ? `$${Number(row.weekly_rate)}/week`
      : "Rate confirmed on your call";

  return { id, heading, weeklyRateLabel };
}

export function rememberPreferredVehicle(id: string | null) {
  if (typeof sessionStorage === "undefined") return;
  if (!id) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, id);
}

export function storedPreferredVehicle(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const value = sessionStorage.getItem(SESSION_KEY);
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
