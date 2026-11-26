import { formatStatusLabel } from "@/lib/ui-display-labels";
import { BLACKLISTED_LABEL } from "@/lib/blacklist";

export const NEEDS_STAFF_LABEL = "Needs Staff";

export type DriverStatusDisplay = {
  /** Title Case text shown in the Status column. */
  label: string;
  /** True when the pill is the red Needs Staff state rather than the saved status. */
  needsStaff: boolean;
  /** True when the pill is the red Blacklisted state (renter_blacklist). */
  blacklisted?: boolean;
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
  flag: { reason?: string | null; escalationCodes?: readonly string[] | null } | null | undefined,
  blacklisted?: { reasonLabel?: string | null } | null,
): DriverStatusDisplay {
  const underlying = status ?? null;
  // Blacklisted outranks every other display, terminal stages included:
  // staff must never miss it.
  if (blacklisted) {
    return {
      label: BLACKLISTED_LABEL,
      needsStaff: false,
      blacklisted: true,
      underlying,
      title: `Blacklisted${blacklisted.reasonLabel ? `: ${blacklisted.reasonLabel}` : ""}. Saved status: ${formatStatusLabel(underlying)}`,
    };
  }
  const masked = status === "declined" || status === "closed";
  if (flag && !masked) {
    const isMatch = (flag.escalationCodes ?? []).includes("blacklist_match");
    const reason = isMatch
      ? "Matches a blacklisted renter"
      : flag.reason ? `FLEET: ${flag.reason}` : "FLEET flagged this applicant for staff";
    return {
      label: NEEDS_STAFF_LABEL,
      needsStaff: true,
      underlying,
      title: `${reason}. Saved status: ${formatStatusLabel(underlying)}`,
    };
  }
  return { label: formatStatusLabel(underlying), needsStaff: false, underlying, title: null };
}
