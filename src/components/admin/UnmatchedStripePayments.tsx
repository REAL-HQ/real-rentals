import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getUnmatchedStripePayments } from "@/lib/stripe-unmatched.functions";
import { formatCents } from "@/lib/stripe-unmatched";
import type { UnmatchedResponse } from "@/lib/stripe-unmatched.functions";

export function UnmatchedStripePayments() {
  const load = useServerFn(getUnmatchedStripePayments);
  const [report, setReport] = useState<UnmatchedResponse | null>(null);
  useEffect(() => {
    let live = true;
    load({ data: {} })
      .then((result) => {
        if (live) setReport(result);
      })
      .catch(() => {
        if (live) setReport({ status: "unavailable", reason: "Unmatched Stripe Payments Could Not Be Loaded", rows: [], truncated: false });
      });
    return () => {
      live = false;
    };
  }, [load]);
  if (!report || report.status === "disabled") return null;
  return (
    <section aria-label="Unmatched Stripe Payments" className="mb-6 rounded-md border border-[#26262B] bg-[#141416] p-4 text-white">
      <h2 className="text-base font-semibold">Unmatched Stripe Payments</h2>
      <p className="mt-1 text-xs text-white/70">Live paid invoices from the last 60 days whose subscription and customer are not on a rental or an application.</p>
      {report.status === "unavailable" && <p role="alert" className="mt-3 text-xs text-white/70">{report.reason}</p>}
      {report.status === "ready" && report.truncated && (
        <p role="status" className="mt-3 text-xs text-white/70">This Read Is Truncated</p>
      )}
      {report.status === "ready" && !report.truncated && report.rows.length === 0 && (
        <p className="mt-3 text-xs text-white/70">No Unmatched Invoices</p>
      )}
      {report.status === "ready" && report.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-white/70">
              <tr>
                {["Invoice", "Subscription", "Customer", "Paid On", "Amount"].map((heading) => (
                  <th key={heading} className="py-2 pr-3 font-medium whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.invoiceId} className="border-t border-[#26262B]">
                  <td className="py-3 pr-3 whitespace-nowrap">{row.invoiceId}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.subscriptionId || "—"}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.customerSuffix || "—"}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.paidOn || "Unknown"}</td>
                  <td className="py-3 whitespace-nowrap tabular-nums">{formatCents(row.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
