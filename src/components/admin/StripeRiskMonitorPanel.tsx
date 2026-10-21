import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminTableScroll } from "./AdminTableScroll";
import { getStripeRiskMonitor } from "@/lib/stripe-risk-monitor.functions";
import { STRIPE_RISK_MONITOR_OFF } from "@/lib/stripe-risk-monitor-flag";
import {
  DIRECTORY_INCOMPLETE,
  STRIPE_CHECK_UNAVAILABLE,
  formatEt,
  stripeRiskMonitorToCsv,
  type RiskReport,
  type RiskRow,
} from "@/lib/stripe-risk-monitor";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * Mounted only while STRIPE_RISK_MONITOR_ENABLED is true.
 * This screen does not respond to a dispute or retry a payment.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: RiskReport };

export function StripeRiskMonitorPanel() {
  const read = useServerFn(getStripeRiskMonitor);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined })
      .then((result) => {
        if (!cancelled) setLoad({ kind: "ready", report: result.report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setLoad({ kind: "unavailable", reason: message === STRIPE_RISK_MONITOR_OFF ? STRIPE_RISK_MONITOR_OFF : "Stripe Disputes & Failed-Payment Monitor could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  const downloadable = load.kind === "ready" && load.report.stripeCheck === "ready" && load.report.directory === "ready";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stripe Disputes & Failed-Payment Monitor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open disputes, failed payments from the last 14 days, and subscriptions that are past due or unpaid. Times are Eastern Time. A difference is evidence only. This screen does not respond to a dispute or retry a payment.
          </p>
        </div>
        {downloadable && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Stripe Disputes & Failed-Payment Monitor…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: RiskReport }) {
  if (report.stripeCheck === "unavailable") return <p className="text-sm text-[#D03020]">{STRIPE_CHECK_UNAVAILABLE}</p>;
  if (report.directory === "unavailable") return <p className="text-sm text-[#D03020]">{DIRECTORY_INCOMPLETE}</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Failed payments from {formatEt(report.gte)} through {formatEt(report.lt)}.</p>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Open Disputes Or Failed Payments.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Kind", "Status", "When", "Decline Code", "Driver", "Payments"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <Row key={`${row.kind}:${row.id}`} row={row} />
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </div>
  );
}

function Row({ row }: { row: RiskRow }) {
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">{row.kindLabel}</td>
      <td className="py-2 pr-3">{row.status}</td>
      <td className="py-2 pr-3">{row.whenEt || "—"}</td>
      <td className="py-2 pr-3">{row.declineCode ?? "—"}</td>
      <td className="py-2 pr-3">
        {row.applicationId ? <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="underline">{row.driverName ?? "Driver"}</Link> : "—"}
      </td>
      <td className="py-2 pr-3">
        <Link to="/admin" search={{ tab: "payments" }} className="underline">Payments</Link>
      </td>
    </tr>
  );
}

function downloadCsv(report: RiskReport) {
  const blob = new Blob([stripeRiskMonitorToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "stripe-disputes-failed-payments.csv";
  link.click();
  URL.revokeObjectURL(url);
}
