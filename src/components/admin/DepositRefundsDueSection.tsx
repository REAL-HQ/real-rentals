import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getDepositRefundsDue } from "@/lib/deposit-refunds-due.functions";
import { formatCents, type DepositRefundsDueReport, type DepositRefundsDueResponse } from "@/lib/deposit-refunds-due";

export function DepositRefundsDueSection() {
  const load = useServerFn(getDepositRefundsDue);
  const [result, setResult] = useState<DepositRefundsDueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    load({ data: {} })
      .then((res) => {
        if (current) setResult(res);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [load]);

  if (!loading && !error && result?.status === "disabled") return null;

  return (
    <section className="mb-4 rounded-xl border border-[#26262B] bg-[#141416] text-white">
      <div className="border-b border-[#26262B] px-4 py-3">
        <h2 className="text-sm font-semibold">Deposit Refunds Due</h2>
        <p className="mt-1 text-xs text-white/70">
          Closed and returned rentals with a held deposit that is not yet refunded or applied.
        </p>
      </div>
      <div className="px-4 py-3">
        {loading ? <p className="text-sm text-white/70">Loading Deposit Refunds Due</p> : null}
        {error || (!loading && result?.status === "degraded") ? (
          <p className="text-sm text-white/70">Deposit Refunds Due Could Not Be Loaded</p>
        ) : null}
        {!loading && !error && result?.status === "capped" ? (
          <p className="text-sm text-white/70">Deposit Refunds Due Is Capped</p>
        ) : null}
        {!loading && !error && result?.status === "ready" ? <ReportView report={result.report} /> : null}
      </div>
    </section>
  );
}

function ReportView({ report }: { report: DepositRefundsDueReport }) {
  if (report.rows.length === 0) return <p className="text-sm text-white/70">No Deposit Refunds Due</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#26262B] text-xs text-white/70">
            <th className="py-2 pr-3 font-medium">Renter</th>
            <th className="py-2 pr-3 font-medium">Days Since Return</th>
            <th className="py-2 font-medium">Amount (Cents)</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.rentalId} className="border-b border-[#26262B]">
              <td className="py-2 pr-3">{row.renter}</td>
              <td className="py-2 pr-3">{row.daysLabel}</td>
              <td className="py-2 tabular-nums">{formatCents(row.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
