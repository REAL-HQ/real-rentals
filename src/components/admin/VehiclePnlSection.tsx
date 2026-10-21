import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getVehiclePnl } from "@/lib/vehicle-pnl.functions";
import { currentEtMonth, previousMonth } from "@/lib/owner-pnl";
import type { VehiclePnlReport } from "@/lib/vehicle-pnl";

/**
 * Mounted only while VEHICLE_PNL_ENABLED is true, inside Expense Categories.
 * One Eastern Time month. This section does not change a record.
 */

type Load =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; report: VehiclePnlReport };

export function VehiclePnlSection() {
  const read = useServerFn(getVehiclePnl);
  const readRef = useRef(read);
  readRef.current = read;
  const today = currentEtMonth(new Date());
  const prior = today ? previousMonth(today) : null;
  const [month, setMonth] = useState(today ?? "");
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    if (!month) {
      setLoad({ kind: "unavailable", reason: "The month could not be dated" });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    void readRef.current({ data: { month } })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ready") setLoad({ kind: "ready", report: result.report });
        else if (result.status === "disabled") setLoad({ kind: "unavailable", reason: "Vehicle Profit Is Off" });
        else setLoad({ kind: "unavailable", reason: result.reason });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoad({
          kind: "unavailable",
          reason: error instanceof Error ? error.message : "Vehicle Profit could not be loaded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const report = load.kind === "ready" ? load.report : null;
  const showUnattributed = report
    ? [report.unattributed.revenueCents, report.unattributed.expenseCents, report.unattributed.tollsTicketsCents, report.unattributed.maintenanceCents]
        .some((cents) => cents === null || cents !== 0)
    : false;

  return (
    <section className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Vehicle Profit</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One Eastern Time month. Verified revenue matches Overview: Stripe net after refunds and
            fees, plus recorded non-Stripe payments. Unknown stays Unknown.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {today && (
            <button
              type="button"
              onClick={() => setMonth(today)}
              className={`rounded-md border px-3 py-1.5 text-sm ${month === today ? "bg-muted font-medium" : ""}`}
            >
              This Month
            </button>
          )}
          {prior && (
            <button
              type="button"
              onClick={() => setMonth(prior)}
              className={`rounded-md border px-3 py-1.5 text-sm ${month === prior ? "bg-muted font-medium" : ""}`}
            >
              Last Month
            </button>
          )}
        </div>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Vehicle Profit</p>}
      {load.kind === "unavailable" && (
        <div className="rounded-lg border p-6 text-center">
          <p className="font-medium">Vehicle Profit</p>
          <p className="mt-1 text-sm text-muted-foreground">{load.reason}</p>
        </div>
      )}
      {report && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {report.from} Through {report.through}
            {report.truncated ? " · Truncated" : ""}
          </p>
          {report.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Vehicles</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="px-3 py-2 font-medium">Vehicle</th>
                    <th className="px-3 py-2 font-medium">Verified Revenue</th>
                    <th className="px-3 py-2 font-medium">Expenses</th>
                    <th className="px-3 py-2 font-medium">Tolls And Tickets</th>
                    <th className="px-3 py-2 font-medium">Maintenance</th>
                    <th className="px-3 py-2 font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.vehicleId} className="border-b align-top">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2">{money(row.revenueCents)}</td>
                      <td className="px-3 py-2">
                        {row.expenses.length === 0 ? (
                          money(row.expenseCents)
                        ) : (
                          <ul>
                            {row.expenses.map((line) => (
                              <li key={line.category}>
                                {line.label} {money(line.cents)}
                              </li>
                            ))}
                            <li>Total {money(row.expenseCents)}</li>
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2">{money(row.tollsTicketsCents)}</td>
                      <td className="px-3 py-2">{money(row.maintenanceCents)}</td>
                      <td className="px-3 py-2">{money(row.netCents)}</td>
                    </tr>
                  ))}
                  {showUnattributed && (
                    <tr className="border-b align-top">
                      <td className="px-3 py-2">Unattributed</td>
                      <td className="px-3 py-2">{money(report.unattributed.revenueCents)}</td>
                      <td className="px-3 py-2">{money(report.unattributed.expenseCents)}</td>
                      <td className="px-3 py-2">{money(report.unattributed.tollsTicketsCents)}</td>
                      <td className="px-3 py-2">{money(report.unattributed.maintenanceCents)}</td>
                      <td className="px-3 py-2">{money(report.unattributed.netCents)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <ul className="space-y-1 text-sm text-muted-foreground">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function money(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents)) return "Unknown";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
