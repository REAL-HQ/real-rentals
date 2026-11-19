import { formatStatusLabel } from "@/lib/ui-display-labels";

export const NEEDS_STAFF_LABEL = "Needs Staff";

export type DriverStatusDisplay = {
  /** Title Case text shown in the Status column. */
  label: string;
  /** True when the pill is the red Needs Staff state rather than the saved status. */
  needsStaff: boolean;
  /** Raw saved application status, unchanged. */
  underlying: string | null;
  /** Hover text explaining the override, or null. */
  title: string | null;
};

/**
 * What the Drivers list Status column shows. An open FLEET Needs Staff flag is
 * not a saved status, so it only overrides the display; the stored status is
 * untouched and returns the moment staff resolve the flag. Terminal stages
 * (declined, closed) are never masked by a stale flag.
 */
export function driverStatusDisplay(
  status: string | null | undefined,
  flag: { reason?: string | null } | null | undefined,
): DriverStatusDisplay {
  const underlying = status ?? null;
  const masked = status === "declined" || status === "closed";
  if (flag && !masked) {
    const reason = flag.reason ? `FLEET: ${flag.reason}` : "FLEET flagged this applicant for staff";
    return {
      label: NEEDS_STAFF_LABEL,
      needsStaff: true,
      underlying,
      title: `${reason}. Saved status: ${formatStatusLabel(underlying)}`,
    };
  }
  return { label: formatStatusLabel(underlying), needsStaff: false, underlying, title: null };
}
