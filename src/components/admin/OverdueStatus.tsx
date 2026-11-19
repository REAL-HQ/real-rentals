import { overdueLabel } from "@/lib/active-rentals";
import { DANGER_BADGE } from "@/lib/badge-tone";

/**
 * Overdue column cell on Active Rentals (Bookings > Active) and any screen
 * that shows the same rental overdue state (driver profile rental tab).
 * Overdue stays the solid red pill; Current uses the same size and shape
 * with the shared green success colors (StatusPill "Paid" / tone green).
 */
const GREEN = { backgroundColor: "rgba(80,192,96,0.08)", color: "#50C060" };

export function OverdueStatus({ days }: { days: number | null }) {
  const label = overdueLabel(days);
  if (days == null) {
    return <span className="text-muted-foreground">{label}</span>;
  }
  if (days > 0) {
    return (
      <span
        data-testid="overdue-pill"
        className={`inline-flex items-center rounded-full ${DANGER_BADGE} px-2 py-0.5 text-[11px] font-semibold`}
      >
        {label}
      </span>
    );
  }
  return (
    <span
      data-testid="overdue-current-pill"
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={GREEN}
    >
      {label}
    </span>
  );
}
