import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getVehicleProfitReport } from "@/lib/vehicle-profitability.functions";
import type { ProfitPeriodId, VehicleProfitReport, VehicleProfitRow } from "@/lib/vehicle-profitability";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Mounted only while VEHICLE_PROFITABILITY_ENABLED is true.
 * Nothing on this screen writes a link, a rental, an expense, or a split.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: VehicleProfitReport };

const PERIODS: { id: ProfitPeriodId; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_90", label: "Last 90 Days" },
];

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const moneyOr = (cents: number | null, empty: string) => cents === null ? empty : money(cents);

export function VehicleProfitPanel() {
  const read = useServerFn(getVehicleProfitReport);
  const [period, setPeriod] = useState<ProfitPeriodId>("this_month");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { period } }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Vehicle Profit could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read, period]);
  if (load.kind === "disabled") return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicle Profit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Eastern Time. Revenue is a Stripe charge only when a payment or rental already names one vehicle. This report does not save anything.
          </p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((item) => (
            <button key={item.id} type="button" onClick={() => setPeriod(item.id)} className={`rounded-md border px-3 py-1.5 text-sm ${period === item.id ? "bg-foreground text-background" : ""}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Vehicle Profit…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <ReportView report={load.report} />}
    </div>
  );
}

function ReportView({ report }: { report: VehicleProfitReport }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{report.from} through {report.through}</p>
      <p className="text-sm">Unattributed Stripe revenue: {moneyOr(report.unattributedStripeRevenueCents, "Not Complete")}</p>
      {report.conflictingCharges > 0 && <p className="text-sm text-muted-foreground">{report.conflictingCharges} charges matched more than one vehicle and stayed in that line.</p>}
      {report.depositsExcludedCents > 0 && <p className="text-sm text-muted-foreground">Deposits excluded: {money(report.depositsExcludedCents)}</p>}
      <AdminTableScroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Vehicle</th>
              <th className="py-2 pr-3 font-medium">Revenue</th>
              <th className="py-2 pr-3 font-medium">Expenses</th>
              <th className="py-2 pr-3 font-medium">Net</th>
              <th className="py-2 pr-3 font-medium">Utilization</th>
              <th className="py-2 pr-3 font-medium">Revenue Per Rented Day</th>
              <th className="py-2 font-medium">Partner Share</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => <VehicleRow key={row.vehicleId} row={row} />)}
          </tbody>
        </table>
      </AdminTableScroll>
    </div>
  );
}

function VehicleRow({ row }: { row: VehicleProfitRow }) {
  const utilization = row.daysRented === null || row.daysOwned === null ? "Not Complete" : `${row.daysRented} / ${row.daysOwned}`;
  const perDay = row.daysRented === 0 ? "No Rented Days" : moneyOr(row.revenuePerRentedDayCents, "Not Complete");
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">{row.label}</td>
      <td className="py-2 pr-3">{moneyOr(row.revenueCents, "Not Complete")}</td>
      <td className="py-2 pr-3">
        {row.expenseCents === null ? "Not Complete" : row.expenses.length === 0 ? money(0) : row.expenses.map((line) => `${line.label} ${money(line.cents)}`).join(", ")}
      </td>
      <td className="py-2 pr-3">{moneyOr(row.netCents, "Not Complete")}</td>
      <td className="py-2 pr-3">{utilization}</td>
      <td className="py-2 pr-3">{perDay}</td>
      <td className="py-2">{row.split === "not_configured" ? "Split not configured" : `${moneyOr(row.partnerShareCents, "Not Complete")}${row.partnerLabel ? ` · ${row.partnerLabel}` : ""}`}</td>
    </tr>
  );
}
