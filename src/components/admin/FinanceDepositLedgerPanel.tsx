import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getFinanceDepositLedger } from "@/lib/finance-deposit-ledger.functions";
import {
  depositLedgerToCsv,
  formatMoney,
  type DepositLedgerReport,
  type DepositLedgerRow,
} from "@/lib/finance-deposit-ledger";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * There is no button that changes a deposit or a rental.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: DepositLedgerReport };

export function FinanceDepositLedgerPanel() {
  const read = useServerFn(getFinanceDepositLedger);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const reason = error instanceof Error && error.message ? error.message : "Deposit Ledger could not be loaded";
      setLoad({ kind: "unavailable", reason });
    });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deposit Ledger</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deposit collected, held, applied to charges, refunded, and the balance still held. This screen does not refund a deposit.</p>
        </div>
        {load.kind === "ready" && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Deposit Ledger…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: DepositLedgerReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Total label="Collected" amount={report.totals.collected} />
        <Total label="Applied To Charges" amount={report.totals.applied} />
        <Total label="Refunded" amount={report.totals.refunded} />
        <Total label="Balance Still Held" amount={report.totals.balance} />
        <div className="rounded-md border px-3 py-2">
          <p className="text-xs text-muted-foreground">Rentals</p>
          <p className="text-lg font-semibold">{report.totals.rentals}</p>
          <p className="text-xs text-muted-foreground">{report.totals.gapRows} with gaps</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Totals add only the amounts this report could read. A blank cell is not zero.</p>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Deposit Records.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Renter", "Rental", "Collected", "Date", "Method", "Held", "Applied", "Refunded", "Balance Still Held", "Gaps"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => <LedgerLine key={row.id} row={row} />)}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
      <div className="rounded-md border px-3 py-2">
        <p className="text-sm font-medium">Not Stored</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {report.standingGaps.map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      </div>
    </div>
  );
}

function Total({ label, amount }: { label: string; amount: number | null }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{formatMoney(amount)}</p>
    </div>
  );
}

function LedgerLine({ row }: { row: DepositLedgerRow }) {
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">{row.renterName}</td>
      <td className="py-2 pr-3">{row.rentalHref ? <Link to="/admin" search={searchFromHref(row.rentalHref)} className="underline">{row.rentalLabel}</Link> : row.rentalLabel}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.collected)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{row.collectedDate ?? "—"}</td>
      <td className="py-2 pr-3">{row.method ?? "—"}</td>
      <td className="py-2 pr-3">{row.held ?? "—"}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.applied)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.refunded)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.balance)}</td>
      <td className="py-2 pr-3 text-muted-foreground">{row.gaps.length ? row.gaps.join(" ") : "—"}</td>
    </tr>
  );
}

function searchFromHref(href: string): { tab: string; id?: string } {
  const url = new URL(href, "https://local.invalid");
  const tab = url.searchParams.get("tab") ?? "overview";
  const id = url.searchParams.get("id");
  return id ? { tab, id } : { tab };
}

function downloadCsv(report: DepositLedgerReport) {
  const blob = new Blob([depositLedgerToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "finance-deposit-ledger.csv";
  link.click();
  URL.revokeObjectURL(url);
}
