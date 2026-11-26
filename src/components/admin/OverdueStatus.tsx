import { dueBadge, etDateISO, overdueLabel } from "@/lib/active-rentals";
import { DANGER_BADGE } from "@/lib/badge-tone";

/**
 * Status column on Active Rentals. Overdue stays the solid red pill.
 * Due today is a flat amber pill. A future due date stays the green Current pill.
 */
const GREEN = { backgroundColor: "rgba(80,192,96,0.08)", color: "#50C060" };

export function OverdueStatus({
  days,
  due = null,
  today,
}: {
  days: number | null;
  due?: string | null;
  today?: string;
}) {
  const state = dueBadge(days, due, today ?? etDateISO());
  if (state === "none") {
    return <span className="text-muted-foreground">{overdueLabel(days)}</span>;
  }
  if (state === "overdue") {
    return (
      <span
        data-testid="overdue-pill"
        className={`inline-flex items-center rounded-full ${DANGER_BADGE} px-2 py-0.5 text-[11px] font-semibold`}
      >
        {overdueLabel(days)}
      </span>
    );
  }
  if (state === "due") {
    return (
      <span
        data-testid="overdue-due-pill"
        className="inline-flex items-center rounded-full bg-[#FFF4D6] px-2 py-0.5 text-[11px] font-semibold text-[#8A6A00]"
      >
        Due
      </span>
    );
  }
  return (
    <span
      data-testid="overdue-current-pill"
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={GREEN}
    >
      Current
    </span>
  );
}
