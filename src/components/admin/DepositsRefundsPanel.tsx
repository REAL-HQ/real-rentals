import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Landmark } from "lucide-react";
import { getDepositsRefundsLedger } from "@/lib/deposits-refunds-ledger.functions";
import type { DepositsRefundsResponse } from "@/lib/deposits-refunds-ledger";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState } from "./ui";

/**
 * Manager read of deposits held, returned, applied, and outstanding.
 * Mounted only while DEPOSITS_LEDGER_ENABLED is true. A deposit is never revenue.
 */

function money(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function DepositsRefundsPanel() {
  const read = useServerFn(getDepositsRefundsLedger);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<DepositsRefundsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    read()
      .then((result) => {
        if (cancelled) return;
        setResponse(result);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProblem(error instanceof Error ? error.message : "The ledger could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  const report = response?.status === "ready" ? response.report : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Held, returned, applied to damages or tolls, and still outstanding, per renter and vehicle. Deposits are never counted as revenue.
      </p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-muted-foreground">Deposits & Refunds Is Off</p>}
      {response?.status === "unavailable" && <p className="text-sm text-[#D03020]">{response.reason}</p>}
      {report && (
        <div className="space-y-4">
          {report.notes.map((note) => (
            <p key={note} className="text-sm text-[#D03020]">{note}</p>
          ))}
          {report.groups.length === 0 ? (
            <EmptyState
              icon={<Landmark className="w-6 h-6" strokeWidth={1.75} />}
              title="No Deposits On File"
              hint="Held deposits will show here, with what was returned or applied."
            />
          ) : (
            <AdminTableScroll className="rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-[#FAFAFB] text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Renter</th>
                    <th className="px-4 py-2.5 font-medium">Vehicle</th>
                    <th className="px-4 py-2.5 font-medium text-right">Held</th>
                    <th className="px-4 py-2.5 font-medium text-right">Returned</th>
                    <th className="px-4 py-2.5 font-medium text-right">Applied To Damages</th>
                    <th className="px-4 py-2.5 font-medium text-right">Applied To Tolls</th>
                    <th className="px-4 py-2.5 font-medium text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{row.renter}</td>
                      <td className="px-4 py-3">{row.vehicle}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(row.heldCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(row.returnedCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(row.damagesCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(row.tollsCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{money(row.outstandingCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-[#FAFAFB]">
                    <td className="px-4 py-3 font-medium" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{money(report.totals.heldCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{money(report.totals.returnedCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{money(report.totals.damagesCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{money(report.totals.tollsCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{money(report.totals.outstandingCents)}</td>
                  </tr>
                </tbody>
              </table>
            </AdminTableScroll>
          )}
          {report.differences.length > 0 && (
            <div className="rounded-xl border border-border">
              <div className="px-4 py-2.5 text-sm font-medium border-b border-border">Stripe Differences</div>
              <ul className="divide-y divide-border">
                {report.differences.map((row) => (
                  <li key={`${row.kind}-${row.id}`} className="px-4 py-2.5 text-sm">
                    <span className="font-medium">{row.kind}</span>
                    <span className="text-muted-foreground"> · {row.id} · Ledger {money(row.appCents)} · Stripe {money(row.stripeCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
