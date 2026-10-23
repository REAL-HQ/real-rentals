import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { AdminTableScroll } from "./AdminTableScroll";
import { getAccountantExport } from "@/lib/accountant-export.functions";
import {
  accountantDetailCsv,
  accountantMonthlyCsv,
  currentEtYear,
  type AccountantMoney,
  type AccountantYearReport,
} from "@/lib/accountant-export";
import type { AccountantExportResponse } from "@/lib/accountant-export.server";

/**
 * Owner screen for one Eastern Time calendar year. Mounted only while
 * ACCOUNTANT_EXPORT_ENABLED is true. Both CSVs are built in the browser.
 * The expense file says whether a receipt is on file and never includes a URL.
 */

function money(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function monthTitle(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return month;
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
}

function download(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const LINES: { key: keyof AccountantMoney; label: string }[] = [
  { key: "revenueCents", label: "Attributed Revenue" },
  { key: "unattributedCents", label: "Unattributed Charges" },
  { key: "refundsCents", label: "Refunds" },
  { key: "depositsCollectedCents", label: "Deposits Collected" },
  { key: "depositsRefundedCents", label: "Deposits Refunded" },
  { key: "expenseCents", label: "Expenses" },
  { key: "netCents", label: "Net" },
];

export function AccountantExportPanel() {
  const read = useServerFn(getAccountantExport);
  const latest = currentEtYear(new Date()) ?? "";
  const [year, setYear] = useState(latest);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<AccountantExportResponse | null>(null);

  useEffect(() => {
    if (!/^\d{4}$/.test(year)) return;
    let cancelled = false;
    setLoading(true);
    setProblem(null);
    read({ data: { year } })
      .then((result) => { if (!cancelled) setResponse(result); })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Accountant export unavailable");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [read, year]);

  const report = response?.status === "ready" ? response.report : null;
  const categories = categoryColumns(report);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Accountant Export</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            One calendar year in Eastern Time. Deposits are collected and refunded on their own lines, and they stay out of net.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            aria-label="Year"
            min={2000}
            max={latest || undefined}
            value={year}
            onChange={(event) => setYear(event.target.value)}
            className="w-28 rounded-lg border border-border bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!report}
            onClick={() => report && download(`accountant-export-${report.year}.csv`, accountantMonthlyCsv(report))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" strokeWidth={1.75} />
            Monthly Summary
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => report && download(`accountant-expenses-${report.year}.csv`, accountantDetailCsv(report))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" strokeWidth={1.75} />
            Expense Detail
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-muted-foreground">Accountant Export Is Off</p>}
      {response?.status === "unavailable" && <p className="text-sm text-[#D03020]">{response.reason}</p>}

      {report && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{report.year} · {report.from} – {report.through}</p>
          {report.warnings.map((warning) => <p key={warning} className="text-sm text-[#D03020]">{warning}</p>)}
          <AdminTableScroll className="rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-[#FAFAFB] text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Month</th>
                  {LINES.map((line) => <th key={line.key} className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{line.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.months.map((month) => (
                  <tr key={month.month} className="border-t border-border">
                    <td className="px-4 py-3 font-medium whitespace-nowrap">{monthTitle(month.month)}</td>
                    {LINES.map((line) => <td key={line.key} className="px-4 py-3 text-right tabular-nums">{money(month[line.key] as number | null)}</td>)}
                  </tr>
                ))}
                <tr className="border-t border-border bg-[#FAFAFB]">
                  <td className="px-4 py-3 font-medium">Year To Date</td>
                  {LINES.map((line) => <td key={line.key} className="px-4 py-3 text-right tabular-nums font-medium">{money(report.ytd[line.key] as number | null)}</td>)}
                </tr>
              </tbody>
            </table>
          </AdminTableScroll>
          <div>
            <h3 className="text-base font-semibold">Expenses By Category</h3>
            <p className="text-sm text-muted-foreground mt-0.5">The same category totals as Monthly Owner P&L. A linked service and its expense count once.</p>
          </div>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No category totals for this year.</p>
          ) : (
            <AdminTableScroll className="rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-[#FAFAFB] text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    {report.months.map((month) => <th key={month.month} className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{monthTitle(month.month)}</th>)}
                    <th className="px-4 py-2.5 font-medium text-right">Year To Date</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category} className="border-t border-border">
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{category}</td>
                      {report.months.map((month) => (
                        <td key={month.month} className="px-4 py-3 text-right tabular-nums">{money(categoryCents(month, category))}</td>
                      ))}
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{money(categoryCents(report.ytd, category))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableScroll>
          )}
          <p className="text-sm text-muted-foreground">
            Expense Detail lists each vehicle expense with the date, vehicle, category, vendor, description, and amount. Receipt On File is Yes or No. The file does not include a receipt link.
          </p>
        </div>
      )}
    </div>
  );
}

function categoryColumns(report: AccountantYearReport | null): string[] {
  if (!report) return [];
  const labels = new Set<string>();
  for (const month of report.months) for (const row of month.expenses) labels.add(row.label);
  for (const row of report.ytd.expenses) labels.add(row.label);
  return [...labels].sort((a, b) => a.localeCompare(b));
}

function categoryCents(row: AccountantMoney, label: string): number | null {
  if (row.expenseCents === null) return null;
  return row.expenses.find((item) => item.label === label)?.cents ?? 0;
}
