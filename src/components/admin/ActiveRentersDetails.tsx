import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { displayPersonName } from "@/lib/display-normalize";
import { fmtDate } from "@/lib/date-format";
import {
  ACTIVE_RENTER_COPY,
  standingLabel,
  weeklyRentLabel,
  type ActiveRentersSummary,
  type RentStandingKind,
} from "@/lib/overview-active-renters";
import { StatusPill } from "./ui";

function standingTone(kind: RentStandingKind): "green" | "amber" | "red" | "neutral" {
  if (kind === "current") return "green";
  if (kind === "due_today") return "amber";
  if (kind === "overdue") return "red";
  return "neutral";
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function dueLine(nextDue: string | null): string {
  const formatted = fmtDate(nextDue);
  return formatted ? `${ACTIVE_RENTER_COPY.due} ${formatted}` : ACTIVE_RENTER_COPY.noDueDate;
}

export function ActiveRentersDetails({
  summary,
  failed,
  canOpenBoard,
}: {
  summary: ActiveRentersSummary | null;
  failed: boolean;
  canOpenBoard: boolean;
}) {
  if (failed) {
    return <p className="text-[11px] text-muted-foreground">{ACTIVE_RENTER_COPY.failed}</p>;
  }
  if (!summary) {
    return <p className="text-[11px] text-muted-foreground">{ACTIVE_RENTER_COPY.loading}</p>;
  }

  return (
    <div className="space-y-1" data-testid="active-renters-details">
      {summary.paymentsLoaded ? (
        <>
          <DetailRow label={ACTIVE_RENTER_COPY.current} value={summary.standing.current} />
          <DetailRow label={ACTIVE_RENTER_COPY.dueToday} value={summary.standing.dueToday} />
          <DetailRow label={ACTIVE_RENTER_COPY.overdue} value={summary.standing.overdue} />
          {summary.standing.noDueDate > 0 ? (
            <DetailRow label={ACTIVE_RENTER_COPY.noDueDate} value={summary.standing.noDueDate} />
          ) : null}
        </>
      ) : (
        <DetailRow label={ACTIVE_RENTER_COPY.paymentStanding} value={ACTIVE_RENTER_COPY.unavailable} />
      )}
      <DetailRow
        label={ACTIVE_RENTER_COPY.weeklyRent}
        value={weeklyRentLabel(summary.weeklyRent, summary.ratesNotSet, summary.ratesKnown)}
      />
      <DetailRow label={ACTIVE_RENTER_COPY.autopayOn} value={summary.autopayOn} />
      <DetailRow label={ACTIVE_RENTER_COPY.returnsDueSoon} value={summary.returnsDueSoon} />
      <DetailRow label={ACTIVE_RENTER_COPY.overdueReturns} value={summary.overdueReturns} />
      <DetailRow
        label={ACTIVE_RENTER_COPY.openSwaps}
        value={summary.openSwaps == null ? ACTIVE_RENTER_COPY.unavailable : summary.openSwaps}
      />
      {summary.rentalsCapped ? (
        <p className="text-[11px] text-muted-foreground">{ACTIVE_RENTER_COPY.moreNotShown}</p>
      ) : null}
      {summary.renters.length === 0 ? (
        <p className="pt-1 text-[11px] text-muted-foreground">{ACTIVE_RENTER_COPY.none}</p>
      ) : (
        <ul className="space-y-2 border-t border-border pt-2">
          {summary.renters.map((row) => {
            const name = row.name ? displayPersonName(row.name) : ACTIVE_RENTER_COPY.unnamed;
            return (
              <li key={row.id}>
                <Link
                  to="/admin"
                  search={{ tab: "bookings", view: "past", id: row.id }}
                  data-testid="active-renter-link"
                  className="flex items-start justify-between gap-2 rounded-md text-left hover:text-destructive"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-foreground">{name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground" title={`${row.vehicle} · ${dueLine(row.nextDue)}`}>
                      {row.vehicle} · {dueLine(row.nextDue)}
                    </span>
                  </span>
                  <StatusPill tone={standingTone(row.standing)} className="shrink-0 px-2 py-0 text-[10px]">
                    {standingLabel(row.standing)}
                  </StatusPill>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {summary.hiddenCount > 0 ? (
        <Link
          to="/admin"
          search={canOpenBoard ? { tab: "bookings" } : { tab: "drivers", filter: "active" }}
          className="inline-flex items-center gap-1 pt-1 text-[11px] text-muted-foreground hover:text-destructive"
        >
          {ACTIVE_RENTER_COPY.viewAll}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}
