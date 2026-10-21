import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DriverReceipt } from "@/lib/driver-receipts";

/**
 * Read-only. Mounted only while DRIVER_RECEIPTS_ENABLED is true. Print uses
 * the browser.
 */
export function DriverReceipts({ read }: { read: () => Promise<DriverReceipt[]> }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["driver-receipts"],
    queryFn: () => read(),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.find((receipt) => receipt.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .driver-receipt, .driver-receipt * { visibility: visible; }
          .driver-receipt { position: absolute; left: 0; top: 0; width: 100%; background: white; }
          .no-print { display: none !important; }
        }
      `}</style>

      <section className="no-print rounded-2xl border border-border bg-white p-5">
        <h3 className="font-semibold">Payment History</h3>
        <p className="mt-1 text-xs text-muted-foreground">Eastern Time</p>
        {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : null}
        {error ? (
          <p className="mt-3 text-sm text-real-red">{error instanceof Error ? error.message : "Could not load payment history."}</p>
        ) : null}
        {data && data.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No past payments.</p> : null}
        {data && data.length > 0 ? (
          <table className="mt-4 w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground text-left">
              <tr>
                <th className="py-2">Date</th>
                <th>What It Was For</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="py-2">{receipt.date ?? "—"}</td>
                  <td>{receipt.purpose ?? "—"}</td>
                  <td>{receipt.status ?? "—"}</td>
                  <td className="text-right">{receipt.amount ?? "—"}</td>
                  <td className="text-right">
                    <button type="button" onClick={() => setOpenId(receipt.id)} className="text-xs font-semibold text-real-red">
                      View Receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {open ? (
        <article className="driver-receipt rounded-2xl border border-border bg-white p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Receipt</div>
              {open.businessName ? <h3 className="mt-1 text-lg font-semibold">{open.businessName}</h3> : null}
            </div>
            <button type="button" onClick={() => window.print()} className="no-print rounded-lg border border-border px-3 py-1.5 text-sm font-medium">
              Print Receipt
            </button>
          </div>
          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Driver" value={open.driverName} />
            <Field label="Date" value={open.date} />
            <Field label="What It Was For" value={open.purpose} />
            <Field label="Amount" value={open.amount} />
            <Field label="Status" value={open.status} />
            <Field label="Vehicle" value={open.vehicle} />
            <Field label="Period" value={open.period} />
          </dl>
          {open.missing.length > 0 ? (
            <p className="mt-5 text-xs text-muted-foreground">Not recorded: {open.missing.join(", ")}</p>
          ) : null}
          <button type="button" onClick={() => setOpenId(null)} className="no-print mt-4 text-xs font-semibold text-muted-foreground">
            Close
          </button>
        </article>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
