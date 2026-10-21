import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Landmark } from "lucide-react";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState } from "./ui";
import { getUnifiedFinanceReport } from "@/lib/unified-finance.functions";
import { financeSessionSnapshot } from "@/lib/unified-finance-session";
import { unifiedFinanceQueryOptions } from "@/lib/unified-finance-query";
import type { FinanceReport } from "@/lib/unified-finance";
import type { FinanceSource, UnifiedFinanceReport, UnifiedFinanceRequest, UnifiedFinanceResponse } from "@/lib/unified-finance-contract";
import { FINANCE_SOURCES } from "@/lib/unified-finance-contract";

/**
 * Standalone manager screen for the reviewed Unified Finance report.
 * The reviewed release branch has no React screen and does not place this
 * on Overview, so there is no Overview hookup to leave behind.
 * Mounted only while UNIFIED_FINANCE_ENDPOINT_ENABLED is true.
 */

const MEASURES: { key: keyof FinanceReport; label: string }[] = [
  { key: "grossCollected", label: "Gross Collected" },
  { key: "earnedRevenue", label: "Earned Revenue" },
  { key: "refunds", label: "Refunds" },
  { key: "chargebacksLost", label: "Chargebacks Lost" },
  { key: "processingFees", label: "Processing Fees" },
  { key: "netCollections", label: "Net Collections" },
  { key: "operatingExpenses", label: "Operating Expenses" },
  { key: "customerCompensation", label: "Customer Compensation" },
  { key: "operatingResult", label: "Operating Result" },
  { key: "depositLiabilityChange", label: "Deposit Liability Change" },
  { key: "actualPayouts", label: "Actual Payouts" },
  { key: "payoutDifference", label: "Payout Difference" },
  { key: "openDisputes", label: "Open Disputes" },
  { key: "projectedRenewals", label: "Projected Renewals" },
  { key: "unverifiedAmount", label: "Unverified Amount" },
];

const SOURCE_LABELS: Record<FinanceSource, string> = {
  stripe: "Stripe",
  payments: "Payments",
  ledger: "Ledger",
  settlements: "Settlements",
  expenses: "Expenses",
  relationships: "Relationships",
};

const PERIODS = [
  { id: "1", label: "This Month" },
  { id: "3", label: "Last 3 Months" },
  { id: "12", label: "Last 12 Months" },
  { id: "all", label: "All Time" },
] as const;

function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function periodRange(id: string): { from: string; to: string } {
  if (id === "all") return { from: "1900-01-01", to: "3000-01-01" };
  const now = new Date();
  const months = id === "12" ? 11 : id === "3" ? 2 : 0;
  const from = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from: ymd(from), to: ymd(to) };
}

function UnmatchedCounts({ unmatched }: { unmatched: NonNullable<UnifiedFinanceReport["unmatched"]> }) {
  const items = [
    [unmatched.charges, "Unmatched Charges"],
    [unmatched.refunds, "Unmatched Refunds"],
    [unmatched.payouts, "Unmatched Payouts"],
    [unmatched.payments, "Unmatched Payments"],
    [unmatched.balanceTransactions, "Unmatched Balance Transactions"],
  ].filter(([count]) => Number(count) > 0);
  if (!items.length) return null;
  return <p className="text-sm text-[#D03020]">{items.map(([count, label]) => `${count} ${label}`).join(" · ")}</p>;
}

function moneyCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function measureText(report: FinanceReport, key: keyof FinanceReport): string {
  const measure = report[key];
  if (!measure || typeof measure !== "object" || !("value" in measure) || !("complete" in measure)) return "Not Complete";
  if (!measure.complete || measure.value === null) return "Not Complete";
  return moneyCents(measure.value);
}

export function UnifiedFinancePanel() {
  const queryClient = useQueryClient();
  const read = useServerFn(getUnifiedFinanceReport);
  const [periodId, setPeriodId] = useState<string>("3");
  const [basis, setBasis] = useState<"cash" | "accrual">("cash");
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<UnifiedFinanceResponse | null>(null);
  const request = useMemo<UnifiedFinanceRequest>(() => ({
    period: periodRange(periodId),
    basis,
    currency: "USD",
  }), [periodId, basis]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const started = Date.now();
    const run = () => {
      if (cancelled) return;
      const session = financeSessionSnapshot(queryClient);
      if (!session.userId) {
        if (Date.now() - started > 8000) {
          setLoading(false);
          setProblem("Finance session is not ready.");
          return;
        }
        timer = window.setTimeout(run, 50);
        return;
      }
      const options = unifiedFinanceQueryOptions(request, session, () => financeSessionSnapshot(queryClient), (next) => read({ data: next }));
      setLoading(true);
      queryClient.fetchQuery(options).then((result) => {
        if (cancelled) return;
        const now = financeSessionSnapshot(queryClient);
        if (now.userId !== session.userId || now.revision !== session.revision) return;
        setResponse(result);
        setProblem(null);
      }).catch((error: unknown) => {
        if (cancelled) return;
        const now = financeSessionSnapshot(queryClient);
        if (now.revision !== session.revision || now.userId !== session.userId || (error instanceof Error && error.message === "Finance session changed")) {
          run();
          return;
        }
        setProblem("Could Not Load Unified Finance");
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    };
    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [queryClient, read, request]);

  const report = response?.status === "ready" ? response.report : null;
  const vehicles = response?.status === "ready" ? response.vehicles : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Unified Finance</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Combined coverage from each finance source, then what each car collected against what it cost.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
            aria-label="Period"
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            {PERIODS.map((period) => (
              <option key={period.id} value={period.id}>{period.label}</option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(["cash", "accrual"] as const).map((next) => (
              <button
                key={next}
                type="button"
                onClick={() => setBasis(next)}
                className={`px-3 py-2 text-sm ${basis === next ? "bg-[rgba(208,48,32,0.08)] text-[#D03020] font-medium" : "bg-white text-muted-foreground"}`}
              >
                {next === "cash" ? "Cash" : "Accrual"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-muted-foreground">Unified Finance Is Off</p>}

      {report && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {report.financialScope === "operating_only" ? "Operating Only" : "Authorized Owner"}
            {" · A card stays Not Complete when its source is missing or an item is unmatched. A missing amount is left blank."}
          </p>
          {([
            ["Verified Collections", report.verifiedCollections],
            ["Posted Ledger", report.postedLedger],
          ] as const).map(([title, section]) => (
            <div key={title} className="space-y-2">
              <h3 className="text-sm font-semibold">{title}</h3>
              {title === "Verified Collections" && report.unmatched && <UnmatchedCounts unmatched={report.unmatched} />}
              <div className="grid gap-3 sm:grid-cols-3">
                {MEASURES.map((item) => (
                  <div key={item.key} className="rounded-xl border border-border p-4">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{measureText(section, item.key)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-border">
            <div className="px-4 py-2.5 text-sm font-medium border-b border-border">Sources</div>
            <ul className="divide-y divide-border">
              {FINANCE_SOURCES.map((source) => {
                const coverage = report.sources[source];
                const state = coverage.state === "complete" ? "Complete" : coverage.state === "incomplete" ? "Incomplete" : "Unavailable";
                return (
                  <li key={source} className="px-4 py-2.5 text-sm">
                    <span className="font-medium">{SOURCE_LABELS[source]}</span>
                    <span className="text-muted-foreground"> · {state}</span>
                    {coverage.reasons.length > 0 && <span className="block text-xs text-muted-foreground mt-0.5">{coverage.reasons.join(" ")}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">Per-Vehicle Profitability</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Paid and refunded rent, late fees, and other charges, using net collected. Deposits are excluded.
            Maintenance is the company share. The window includes the start date and excludes the end date.
            These lines are the existing profitability definition, separate from the combined totals above.
          </p>
        </div>
        {vehicles && !vehicles.complete && (
          <p className="text-sm text-[#D03020]">Not Complete. {vehicles.reasons.join(" ")}</p>
        )}
        {vehicles?.complete && vehicles.rows.length === 0 && (
          <EmptyState
            icon={<Landmark className="w-6 h-6" strokeWidth={1.75} />}
            title="No Vehicles Yet"
            hint="Add your cars, and this will show what each one earns against what it costs."
          />
        )}
        {vehicles?.complete && vehicles.rows.length > 0 && (
          <AdminTableScroll className="rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-[#FAFAFB] text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Vehicle</th>
                  <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
                  <th className="px-4 py-2.5 font-medium text-right">Expenses</th>
                  <th className="px-4 py-2.5 font-medium text-right">Maintenance</th>
                  <th className="px-4 py-2.5 font-medium text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.rows.map((row) => (
                  <tr key={row.vehicleId} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{moneyCents(row.revenueCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{moneyCents(row.expenseCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{moneyCents(row.maintenanceCents)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${row.netCents >= 0 ? "text-[#16A34A]" : "text-[#D03020]"}`}>
                      {moneyCents(row.netCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
        )}
      </div>
    </div>
  );
}
