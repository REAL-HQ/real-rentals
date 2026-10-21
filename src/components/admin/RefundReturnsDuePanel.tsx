import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getRefundReturnsDue } from "@/lib/refund-returns-due.functions";
import {
  STRIPE_CHECK_UNAVAILABLE,
  formatReturnCents,
  refundReturnsToCsv,
  returnMoneyText,
  type RefundReturnsReport,
} from "@/lib/refund-returns-due";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * There is no button that refunds a deposit or changes a rental.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: RefundReturnsReport };

export function RefundReturnsDuePanel() {
  const read = useServerFn(getRefundReturnsDue);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const reason = error instanceof Error && error.message ? error.message : "Refunds & Deposit Returns Due could not be loaded";
      setLoad({ kind: "unavailable", reason });
    });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Refunds & Deposit Returns Due</h1>
          <p className="mt-1 text-sm text-muted-foreground">Closed rentals with a deposit that has not been returned. Days are Eastern Time days since the rental closed. This screen does not send a refund.</p>
        </div>
        {load.kind === "ready" && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Refunds & Deposit Returns Due…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: RefundReturnsReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border px-3 py-2">
          <p className="text-xs text-muted-foreground">Still Due</p>
          <p className="text-lg font-semibold">{returnMoneyText(report.stillDueCents, report.unknownCount)}</p>
        </div>
        <div className="rounded-md border px-3 py-2">
          <p className="text-xs text-muted-foreground">Rentals</p>
          <p className="text-lg font-semibold">{report.rows.length}</p>
        </div>
        <div className="rounded-md border px-3 py-2">
          <p className="text-xs text-muted-foreground">As Of (ET)</p>
          <p className="text-lg font-semibold">{report.today}</p>
        </div>
      </div>
      {report.note && <p className="text-sm text-muted-foreground">{report.note}</p>}
      {report.stripeCheck === "unavailable" && <p className="text-sm text-muted-foreground">{STRIPE_CHECK_UNAVAILABLE}</p>}
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Deposit Returns Due.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Renter", "Vehicle", "Rental", "Days Since Close", "Still Due", "Deposit Status"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.rentalId} className="border-b align-top">
                  <td className="py-2 pr-3">{row.renter}</td>
                  <td className="py-2 pr-3">{row.vehicle}</td>
                  <td className="py-2 pr-3">
                    <Link to="/admin" search={{ tab: "bookings", id: row.rentalId }} className="underline">{row.rentalLabel}</Link>
                  </td>
                  <td className="py-2 pr-3">{row.daysSinceClose == null ? "Not Recorded" : row.daysSinceClose}</td>
                  <td className="py-2 pr-3">{formatReturnCents(row.stillDueCents)}</td>
                  <td className="py-2 pr-3">
                    <div>{row.depositStatus}</div>
                    {row.notes.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{row.notes.join(" ")}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </div>
  );
}

function downloadCsv(report: RefundReturnsReport) {
  const blob = new Blob([refundReturnsToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `refund-returns-due-${report.today}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
