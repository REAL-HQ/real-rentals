import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getDriverStatement } from "@/lib/driver-statement.functions";
import { statementToCsv, type DriverStatementReport } from "@/lib/driver-statement";

/**
 * Read-only. Download CSV builds a file in the browser from the rows already
 * on screen. It does not call the server again and it does not store a file.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: DriverStatementReport };

const money = (cents: number | null, currency = "usd") => {
  if (cents === null) return "—";
  if (currency === "usd") return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;
};

export function DriverStatement({ driverId }: { driverId: string }) {
  const read = useServerFn(getDriverStatement);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { driverId } }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Driver Statement could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read, driverId]);

  return (
    <div className="rounded-xl border border-border bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Statement</div>
        {load.kind === "ready" && (
          <button type="button" onClick={() => downloadStatement(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      <div className="p-4 space-y-4">
        <p className="text-[12px] text-[#9A9AA3]">Charges, refunds, and subscription invoices matched to this driver. Dates are Eastern Time. Download CSV uses these rows only.</p>
        {load.kind === "loading" && <p className="text-[13px] text-[#55555E]">Loading Statement…</p>}
        {load.kind === "disabled" && <p className="text-[13px] text-[#55555E]">Driver Statement Is Off.</p>}
        {load.kind === "unavailable" && <p className="text-[13px] text-[#55555E]">{load.reason}</p>}
        {load.kind === "ready" && (
          <>
            {load.report.totals ? (
              <dl className="grid gap-3 sm:grid-cols-3">
                <Total label="Paid" value={money(load.report.totals.paidCents)} />
                <Total label="Refunded" value={money(load.report.totals.refundedCents)} />
                <Total label="Outstanding" value={money(load.report.totals.outstandingCents)} />
              </dl>
            ) : <p className="text-[13px] text-[#55555E]">Totals are withheld. This statement includes a non-USD amount.</p>}
            {load.report.rows.length === 0 ? <p className="text-[13px] text-[#55555E]">No Stripe activity matched to this driver.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-[#9A9AA3]">
                      {["Date", "Description", "Amount", "Status", "Paid", "Refunded", "Outstanding"].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {load.report.rows.map((row) => (
                      <tr key={row.id} className="border-b align-top">
                        <td className="py-2 pr-3">{row.date ?? "—"}</td>
                        <td className="py-2 pr-3">{row.description}</td>
                        <td className="py-2 pr-3">{money(row.amountCents, row.currency)}</td>
                        <td className="py-2 pr-3">{row.status}</td>
                        <td className="py-2 pr-3">{money(row.runningPaid)}</td>
                        <td className="py-2 pr-3">{money(row.runningRefunded)}</td>
                        <td className="py-2">{money(row.runningOutstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-[12px] text-[#9A9AA3]">{label}</dt>
      <dd className="mt-1 text-[15px] font-semibold">{value}</dd>
    </div>
  );
}

function downloadStatement(report: DriverStatementReport) {
  const blob = new Blob([statementToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "driver-statement.csv";
  link.click();
  URL.revokeObjectURL(url);
}
