import { AlertTriangle } from "lucide-react";
import type { PaymentsSummary } from "@/lib/payments-summary";
import { fmtDate } from "@/lib/date-format";

const usd = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * Summary cards at the top of Payments, styled like the Vehicles page stat cards. Numbers come
 * from buildPaymentsSummary with the same rows and owed rule as the table, so they always agree.
 */
export function PaymentSummaryCards({
  summary,
  overdueActive,
  collectionsActive,
  failedActive,
  onOverdue,
  onCollections,
  onFailed,
}: {
  summary: PaymentsSummary;
  overdueActive: boolean;
  collectionsActive: boolean;
  failedActive: boolean;
  onOverdue: () => void;
  onCollections?: () => void;
  onFailed: () => void;
}) {
  const { overdue, dueThisWeek, collectedThisWeek, inCollections, failedRecent } = summary;
  const pct = collectedThisWeek.expected > 0 ? Math.round((collectedThisWeek.collected / collectedThisWeek.expected) * 100) : null;
  return (
    <div className="mb-4 space-y-3" data-testid="payment-summary">
      {failedRecent.count > 0 ? (
        <button
          type="button"
          onClick={onFailed}
          aria-pressed={failedActive}
          data-testid="payment-failed-alert"
          className={`flex w-full items-center gap-2 rounded-2xl border bg-rose-50 px-4 py-2.5 text-left text-sm text-rose-800 shadow-sm transition-colors ${failedActive ? "border-[#D03020]" : "border-rose-200 hover:border-[#D03020]"}`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="font-semibold">Failed Payments</span>
          <span>
            {failedRecent.count} in the last 3 days · {usd(failedRecent.total)} still owed
          </span>
          <span className="ml-auto text-xs font-medium">View</span>
        </button>
      ) : null}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="payment-stat-cards">
        <PaymentStatCard
          testId="payment-card-overdue"
          label="Overdue Now"
          value={usd(overdue.total)}
          tone={overdue.total > 0 ? "red" : undefined}
          hint={
            overdue.renters === 0
              ? "No one is late"
              : `${overdue.renters} renter${overdue.renters === 1 ? "" : "s"} late${overdue.oldestDaysLate != null ? ` · Oldest ${overdue.oldestDaysLate} day${overdue.oldestDaysLate === 1 ? "" : "s"}` : ""}`
          }
          active={overdueActive}
          onClick={onOverdue}
        />
        <PaymentStatCard
          testId="payment-card-due-week"
          label="Due This Week"
          value={usd(dueThisWeek.total)}
          hint={dueThisWeek.count === 0 ? "Nothing due in the next 7 days" : `Autopay ${usd(dueThisWeek.autopay)} · Link/Manual ${usd(dueThisWeek.manual)}`}
        />
        <PaymentStatCard
          testId="payment-card-collected-week"
          label="Collected This Week"
          value={usd(collectedThisWeek.collected)}
          hint={`Of ${usd(collectedThisWeek.expected)} expected${pct != null ? ` (${pct}%)` : ""} · Since ${fmtDate(collectedThisWeek.weekStart)}`}
        />
        <PaymentStatCard
          testId="payment-card-collections"
          label="In Collections"
          value={inCollections ? usd(inCollections.total) : "—"}
          hint={inCollections ? `${inCollections.renters} renter${inCollections.renters === 1 ? "" : "s"} · Not In Outstanding` : "Managers And Owners"}
          active={collectionsActive}
          onClick={onCollections}
        />
      </div>
    </div>
  );
}

function PaymentStatCard({
  label,
  value,
  hint,
  active = false,
  tone,
  onClick,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  active?: boolean;
  tone?: "red";
  onClick?: () => void;
  testId?: string;
}) {
  const className = `min-w-0 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition-colors ${
    onClick ? (active ? "border-[#D03020]" : "border-[#EDEDF0] hover:border-[#D03020]") : "border-[#EDEDF0]"
  }`;
  const body = (
    <>
      <div className="text-[10px] font-semibold text-muted-foreground">{label}</div>
      <div className={`mt-1 text-[18px] font-semibold tabular-nums ${tone === "red" ? "text-[#D03020]" : ""}`}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-[#55555E]">{hint}</div> : null}
    </>
  );
  if (!onClick) return <div className={className} data-testid={testId}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={`${label} ${value}`} className={className} data-testid={testId}>
      {body}
    </button>
  );
}
