import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getStripePayoutMatch, type PayoutMatchResponse } from "@/lib/stripe-payout-match.functions";
import { formatCents } from "@/lib/stripe-unmatched";

export function StripePayoutMatch() {
  const load = useServerFn(getStripePayoutMatch);
  const [report, setReport] = useState<PayoutMatchResponse | null>(null);
  useEffect(() => {
    let live = true;
    load({ data: {} })
      .then((result) => {
        if (live) setReport(result);
      })
      .catch(() => {
        if (live) setReport({ status: "unavailable", reason: "Stripe Payout Match Could Not Be Loaded", payouts: [], unmatched: [], paidNotInPayout: [], truncated: false });
      });
    return () => {
      live = false;
    };
  }, [load]);
  if (!report || report.status === "disabled") return null;
  const ready = report.status === "ready";
  return (
    <section aria-label="Stripe Payout Match" className="mb-6 rounded-md border border-[#26262B] bg-[#141416] p-4 text-white">
      <h2 className="text-base font-semibold">Stripe Payout Match</h2>
      <p className="mt-1 text-xs text-white/70">Live payouts from the last 60 days. A charge is unmatched when its payment intent is not on a payments row. Fleet Link uses the same rental and application match as unmatched invoices.</p>
      {report.status === "unavailable" && <p role="alert" className="mt-3 text-xs text-white/70">{report.reason}</p>}
      {ready && report.truncated && <p role="status" className="mt-3 text-xs text-white/70">This Read Is Truncated</p>}
      {ready && report.payouts.length === 0 && !report.truncated && <p className="mt-3 text-xs text-white/70">No Payouts</p>}
      {ready && report.payouts.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-white/70">
              <tr>
                {["Payout", "Arrival", "Status", "Amount"].map((heading) => (
                  <th key={heading} className="py-2 pr-3 font-medium whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.payouts.map((row) => (
                <tr key={row.id} className="border-t border-[#26262B]">
                  <td className="py-3 pr-3 whitespace-nowrap">{row.id}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.arrival || "Unknown"}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.status}</td>
                  <td className="py-3 whitespace-nowrap tabular-nums">{formatCents(row.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ready && report.unmatched.length > 0 && <ChargeTable rows={report.unmatched} />}
      {ready && !report.truncated && report.unmatched.length === 0 && report.payouts.length > 0 && (
        <p className="mt-3 text-xs text-white/70">No Unmatched Charges</p>
      )}
      {ready && report.paidNotInPayout.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Paid Not In A Payout</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-white/70">
                <tr>
                  {["Payment", "Payment Intent", "Paid On", "Amount"].map((heading) => (
                    <th key={heading} className="py-2 pr-3 font-medium whitespace-nowrap">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.paidNotInPayout.map((row) => (
                  <tr key={row.paymentId} className="border-t border-[#26262B]">
                    <td className="py-3 pr-3 whitespace-nowrap">{row.paymentId}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{row.paymentIntentId}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{row.paidOn}</td>
                    <td className="py-3 whitespace-nowrap tabular-nums">{formatCents(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ChargeTable({ rows }: { rows: Extract<PayoutMatchResponse, { status: "ready" }>["unmatched"] }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">Unmatched Charges</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-white/70">
            <tr>
              {["Payout", "Charge", "Payment Intent", "Customer", "Amount", "Fleet Link"].map((heading) => (
                <th key={heading} className="py-2 pr-3 font-medium whitespace-nowrap">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.payoutId}:${row.chargeId}`} className="border-t border-[#26262B]">
                <td className="py-3 pr-3 whitespace-nowrap">{row.payoutId}</td>
                <td className="py-3 pr-3 whitespace-nowrap">{row.chargeId}</td>
                <td className="py-3 pr-3 whitespace-nowrap">{row.paymentIntentId || "—"}</td>
                <td className="py-3 pr-3 whitespace-nowrap">{row.customerSuffix || "—"}</td>
                <td className="py-3 pr-3 whitespace-nowrap tabular-nums">{formatCents(row.amountCents)}</td>
                <td className="py-3 whitespace-nowrap">{row.fleetLinked == null ? "Unknown" : row.fleetLinked ? "Linked" : "Not Linked"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
