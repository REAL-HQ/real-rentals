import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getFinanceMonthlyPl } from "@/lib/finance-monthly-pl.functions";
import { currentMonth, formatMoney, monthlyPlToCsv, type MonthlyPlReport } from "@/lib/finance-monthly-pl";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * Print uses the statement already on the page. Nothing here writes a payment.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: MonthlyPlReport };

export function FinanceMonthlyPlPanel() {
  const read = useServerFn(getFinanceMonthlyPl);
  const [month, setMonth] = useState(() => currentMonth(new Date()) ?? "");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { month } }).then((result) => {
      if (cancelled) return;
      if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const reason = error instanceof Error && error.message ? error.message : "Monthly P&L could not be loaded";
      setLoad({ kind: "unavailable", reason });
    });
    return () => { cancelled = true; };
  }, [read, month]);

  return (
    <div className="monthly-pl space-y-6 print:space-y-4 print:text-black">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monthly P&L Statement</h1>
          <p className="mt-1 text-sm text-muted-foreground">One Eastern Time month. Rental income, refunds, and costs from the payments, expenses, and maintenance already on file. This screen does not change a payment.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Month</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
          </label>
          {load.kind === "ready" && (
            <>
              <button type="button" onClick={() => window.print()} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">Print</button>
              <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">Download CSV</button>
            </>
          )}
        </div>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Monthly P&L…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Statement report={load.report} />}
    </div>
  );
}

function Statement({ report }: { report: MonthlyPlReport }) {
  const income = report.income.reduce((sum, line) => sum + line.cents, 0);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{report.from} through {report.through}, Eastern Time.</p>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Income</h2>
        <Lines rows={[...report.income, { label: "Income", cents: income }, { label: "Refunds", cents: report.refundCents }]} emphasize={["Income", "Refunds"]} />
        <p className="text-sm">Stripe Fees: Unavailable</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Expenses</h2>
        {report.expenses.length === 0 ? <p className="text-sm text-muted-foreground">No Expenses.</p> : <Lines rows={report.expenses} />}
        <p className="text-sm">Expenses {formatMoney(report.expenseCents)}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Maintenance</h2>
        {report.maintenance.length === 0 ? <p className="text-sm text-muted-foreground">No Maintenance.</p> : <Lines rows={report.maintenance} />}
        <p className="text-sm">Maintenance {formatMoney(report.maintenanceCents)}</p>
      </section>
      <p className="text-lg font-semibold">Net {formatMoney(report.netCents)}</p>
      <p className="text-sm text-muted-foreground">Deposits excluded {formatMoney(report.depositsExcludedCents)}. Net does not subtract Stripe fees.</p>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">By Vehicle</h2>
        {report.vehicles.length === 0 ? <p className="text-sm text-muted-foreground">No Vehicle Activity.</p> : (
          <AdminTableScroll>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {["Vehicle", "Rent", "Late Fees", "Other", "Refunds", "Expenses", "Maintenance", "Net"].map((head) => (
                    <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.vehicles.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.rentCents)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.lateFeeCents)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.otherCents)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.refundCents)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.expenseCents)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.maintenanceCents)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
        )}
      </section>
      <section className="rounded-md border px-3 py-2 print:border-black">
        <p className="text-sm font-medium">Not Stored</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {report.standingGaps.map((gap) => <li key={gap}>{gap}</li>)}
          {report.gaps.map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      </section>
    </div>
  );
}

function Lines({ rows, emphasize = [] }: { rows: Array<{ label: string; cents: number }>; emphasize?: string[] }) {
  return (
    <table className="w-full max-w-xl text-sm">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b">
            <td className={`py-1.5 pr-3 ${emphasize.includes(row.label) ? "font-medium" : ""}`}>{row.label}</td>
            <td className="py-1.5 text-right whitespace-nowrap">{formatMoney(row.cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function downloadCsv(report: MonthlyPlReport) {
  const blob = new Blob([monthlyPlToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "finance-monthly-pl.csv";
  link.click();
  URL.revokeObjectURL(url);
}

const PRINT_CSS = `@media print {
  .monthly-pl, .monthly-pl * { color: #000 !important; background: #fff !important; }
  .monthly-pl table { width: 100%; border-collapse: collapse; }
  .monthly-pl th, .monthly-pl td { border-bottom: 1px solid #000; padding: 4px 8px 4px 0; }
  .monthly-pl section { break-inside: avoid; }
}`;
