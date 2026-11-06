import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getRentAging } from "@/lib/rent-aging.functions";
import { formatMoney, rentAgingToCsv, type AgingReport, type AgingRow } from "@/lib/rent-aging";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * There is no button that changes a payment or a rental.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: AgingReport };

export function RentAgingPanel() {
  const read = useServerFn(getRentAging);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const reason = error instanceof Error && error.message ? error.message : "Rent Aging could not be loaded";
      setLoad({ kind: "unavailable", reason });
    });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rent Aging</h1>
          <p className="mt-1 text-sm text-muted-foreground">Outstanding renter balances by how many Eastern Time days they are past due. This screen does not collect a payment.</p>
        </div>
        {load.kind === "ready" && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Rent Aging…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: AgingReport }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">As of {report.asOf}, Eastern Time.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {report.totals.map((total) => (
          <div key={total.id} className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">{total.label}</p>
            <p className="text-lg font-semibold">{formatMoney(total.amount)}</p>
            <p className="text-xs text-muted-foreground">{total.count} rental{total.count === 1 ? "" : "s"}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Total due {formatMoney(report.totalAmount)}.</p>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Outstanding Balances.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Renter", "Rental", "Amount Due", "Oldest Unpaid", "Last Payment"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => <AgingLine key={row.id} row={row} />)}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </div>
  );
}

function AgingLine({ row }: { row: AgingRow }) {
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">{row.renterHref ? <Link to="/admin" search={searchFromHref(row.renterHref)} className="underline">{row.renterName}</Link> : row.renterName}</td>
      <td className="py-2 pr-3">{row.rentalHref ? <Link to="/admin" search={searchFromHref(row.rentalHref)} className="underline">{row.rentalLabel}</Link> : row.rentalLabel}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatMoney(row.amountDue)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{row.oldestUnpaid ?? "No Due Date"}</td>
      <td className="py-2 whitespace-nowrap">{row.lastPayment ?? "No Payment"}</td>
    </tr>
  );
}

function searchFromHref(href: string): { tab: string; id?: string } {
  const url = new URL(href, "https://local.invalid");
  const tab = url.searchParams.get("tab") ?? "overview";
  const id = url.searchParams.get("id");
  return id ? { tab, id } : { tab };
}

function downloadCsv(report: AgingReport) {
  const blob = new Blob([rentAgingToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rent-aging.csv";
  link.click();
  URL.revokeObjectURL(url);
}
