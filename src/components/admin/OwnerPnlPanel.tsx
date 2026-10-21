import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { AdminTableScroll } from "./AdminTableScroll";
import { getOwnerPnl } from "@/lib/owner-pnl.functions";
import {
  currentEtMonth,
  ownerPnlCsv,
  type OwnerExpenseGroup,
  type OwnerPnlReport,
} from "@/lib/owner-pnl";
import type { OwnerPnlResponse } from "@/lib/owner-pnl.server";

/**
 * Owner screen for one Eastern Time month. Mounted only while
 * OWNER_PNL_ENABLED is true. CSV and Print are built in the browser.
 */

function money(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function monthTitle(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return month;
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

function downloadCsv(report: OwnerPnlReport) {
  const blob = new Blob([ownerPnlCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `owner-pnl-${report.current.month}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function unionCategories(report: OwnerPnlReport): { label: string; current: number | null; previous: number | null }[] {
  const rows = new Map<string, { label: string; current: number | null; previous: number | null }>();
  const take = (groups: OwnerExpenseGroup[], side: "current" | "previous") => {
    for (const group of groups) {
      const existing = rows.get(group.category) ?? { label: group.label, current: report.current.expensesComplete ? 0 : null, previous: report.previous.expensesComplete ? 0 : null };
      existing[side] = group.cents;
      rows.set(group.category, existing);
    }
  };
  take(report.current.expenses, "current");
  take(report.previous.expenses, "previous");
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function OwnerPnlPanel() {
  const read = useServerFn(getOwnerPnl);
  const [month, setMonth] = useState(() => currentEtMonth(new Date()) ?? "");
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<OwnerPnlResponse | null>(null);
  const latest = currentEtMonth(new Date()) ?? month;

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setLoading(true);
    setProblem(null);
    read({ data: { month } })
      .then((result) => { if (!cancelled) setResponse(result); })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Owner P&L unavailable");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [read, month]);

  const report = response?.status === "ready" ? response.report : null;
  const lines = report ? [
    ["Revenue", report.current.revenueCents, report.previous.revenueCents, report.change.revenueCents],
    ["Refunds", report.current.refundsCents, report.previous.refundsCents, report.change.refundsCents],
    ["Expenses", report.current.expenseCents, report.previous.expenseCents, report.change.expenseCents],
    ["Net", report.current.netCents, report.previous.netCents, report.change.netCents],
  ] as const : [];

  return (
    <div className="owner-pnl space-y-5">
      <style>{PRINT_CSS}</style>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Monthly Owner P&L</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Attributed revenue, refunds, and expenses for one Eastern Time month, next to the month before. Deposits stay off the net.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <input
            type="month"
            aria-label="Month"
            value={month}
            max={latest}
            onChange={(event) => setMonth(event.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            Print
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => report && downloadCsv(report)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" strokeWidth={1.75} />
            Download CSV
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-muted-foreground">Monthly Owner P&L Is Off</p>}
      {response?.status === "unavailable" && <p className="text-sm text-[#D03020]">{response.reason}</p>}

      {report && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {monthTitle(report.current.month)} · {report.current.from} – {report.current.through} · Compared With {monthTitle(report.previous.month)}
          </p>
          {(!report.current.revenueComplete || !report.previous.revenueComplete) && (
            <p className="text-sm text-[#D03020]">Revenue Is Incomplete. Amounts that depend on it are left blank.</p>
          )}
          {(!report.current.expensesComplete || !report.previous.expensesComplete) && (
            <p className="text-sm text-[#D03020]">Expenses Are Incomplete. Amounts that depend on them are left blank.</p>
          )}
          {(!report.current.refundsComplete || !report.previous.refundsComplete) && (
            <p className="text-sm text-[#D03020]">Refunds Are Incomplete. Amounts that depend on them are left blank.</p>
          )}
          {(report.current.conflictingCharges > 0 || report.previous.conflictingCharges > 0) && (
            <p className="text-sm text-[#D03020]">Some charges named more than one vehicle and stayed unattributed.</p>
          )}
          <AdminTableScroll className="rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-[#FAFAFB] text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Line</th>
                  <th className="px-4 py-2.5 font-medium text-right">This Month</th>
                  <th className="px-4 py-2.5 font-medium text-right">Previous Month</th>
                  <th className="px-4 py-2.5 font-medium text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(([label, current, previous, change]) => (
                  <tr key={label} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{label}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(current)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(previous)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
          <p className="text-sm text-muted-foreground">
            Unattributed Revenue {money(report.current.unattributedRevenueCents)} · Deposits Excluded {money(report.current.depositsExcludedCents)} · Deposit Refunds Excluded {money(report.current.depositRefundsExcludedCents)}
          </p>
          <div>
            <h3 className="text-base font-semibold">Expenses By Category</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Grouped by the category on each vehicle expense. A linked service and its expense count once.</p>
          </div>
          {unionCategories(report).length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses in these months.</p>
          ) : (
            <AdminTableScroll className="rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-[#FAFAFB] text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium text-right">This Month</th>
                    <th className="px-4 py-2.5 font-medium text-right">Previous Month</th>
                  </tr>
                </thead>
                <tbody>
                  {unionCategories(report).map((row) => (
                    <tr key={row.label} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{row.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(row.current)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(row.previous)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableScroll>
          )}
        </div>
      )}
    </div>
  );
}

const PRINT_CSS = `@media print {
  .owner-pnl, .owner-pnl * { color: #000 !important; background: #fff !important; }
  .owner-pnl table { width: 100%; border-collapse: collapse; }
  .owner-pnl th, .owner-pnl td { border-bottom: 1px solid #000; padding: 4px 8px 4px 0; }
  .owner-pnl section, .owner-pnl table { break-inside: avoid; }
}`;
