import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getBillingHealth } from "@/lib/billing-health.functions";
import { billingHealthToCsv, type BillingHealthReport, type BillingMismatch } from "@/lib/billing-health";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * There is no button that changes a rental or a Stripe subscription.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: BillingHealthReport };

export function BillingHealthPanel() {
  const read = useServerFn(getBillingHealth);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Billing Health could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">Active rentals compared with Stripe subscriptions and customers. This screen does not change a rental or a subscription.</p>
        </div>
        {load.kind === "ready" && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Billing Health…</p>}
      {load.kind === "disabled" && <p className="text-sm text-muted-foreground">Billing Health Is Off.</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: BillingHealthReport }) {
  return (
    <div className="space-y-4">
      {report.warnings.map((warning) => (
        <p key={warning} className="text-sm text-[#D03020]">{warning}</p>
      ))}
      {report.activeRentals !== null && report.subscriptions !== null && (
        <p className="text-sm text-muted-foreground">
          {report.activeRentals} active rental{report.activeRentals === 1 ? "" : "s"} and {report.subscriptions} Stripe subscription{report.subscriptions === 1 ? "" : "s"} checked.
        </p>
      )}
      {report.mismatches.length === 0 && report.warnings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Billing Mismatches.</p>
      ) : report.mismatches.length === 0 ? null : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Driver", "Vehicle", "Reason", "Subscription", "Weekly Rate", "Subscription Amount", "Next Payment Due", "Period End"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.mismatches.map((row) => <Mismatch key={row.id} row={row} />)}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </div>
  );
}

function Mismatch({ row }: { row: BillingMismatch }) {
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">
        {row.applicationId ? (
          <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="underline">{row.driverName}</Link>
        ) : row.driverName}
      </td>
      <td className="py-2 pr-3">
        {row.rentalId ? (
          <Link to="/admin" search={{ tab: "bookings", id: row.rentalId }} className="underline">{row.vehicleLabel}</Link>
        ) : row.vehicleLabel}
      </td>
      <td className="py-2 pr-3">{row.reason}</td>
      <td className="py-2 pr-3">{row.subscriptionId ?? "No Subscription"}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{row.weeklyRate}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{row.subscriptionAmount}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{row.nextPaymentDue}</td>
      <td className="py-2 whitespace-nowrap">{row.periodEnd}</td>
    </tr>
  );
}

function downloadCsv(report: BillingHealthReport) {
  const blob = new Blob([billingHealthToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "billing-health.csv";
  link.click();
  URL.revokeObjectURL(url);
}
