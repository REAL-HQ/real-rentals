import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminTableScroll } from "./AdminTableScroll";
import { getVehicleProfitReport } from "@/lib/vehicle-profitability.functions";
import { VEHICLE_PROFITABILITY_OFF } from "@/lib/vehicle-profitability-flag";
import {
  DIRECTORY_INCOMPLETE,
  defaultProfitRange,
  formatCents,
  formatUtilization,
  vehicleProfitToCsv,
  type VehicleProfitReport,
  type VehicleProfitRow,
} from "@/lib/vehicle-profitability";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * Mounted only while VEHICLE_PROFITABILITY_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: VehicleProfitReport };

export function VehicleProfitPanel() {
  const read = useServerFn(getVehicleProfitReport);
  const initial = defaultProfitRange(new Date());
  const [from, setFrom] = useState(initial?.from ?? "");
  const [through, setThrough] = useState(initial?.through ?? "");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const rangeValid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(through) && from <= through;
  useEffect(() => {
    if (!rangeValid) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { from, through } })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
        else setLoad({ kind: "ready", report: result.report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setLoad({ kind: "unavailable", reason: message === VEHICLE_PROFITABILITY_OFF ? VEHICLE_PROFITABILITY_OFF : "Vehicle Profitability could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read, from, through, rangeValid]);

  const downloadable = load.kind === "ready";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicle Profitability</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Collected revenue is a paid payment, net of refunds, attributed through the rental&apos;s vehicle. Expenses are vehicle expense amounts. Maintenance is the company share, and a service that already has an expense is counted once. This screen does not save anything.
          </p>
        </div>
        {downloadable && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">From</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-md border bg-background px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Through</span>
          <input type="date" value={through} onChange={(event) => setThrough(event.target.value)} className="rounded-md border bg-background px-2 py-1.5" />
        </label>
      </div>
      {!rangeValid && <p className="text-sm text-muted-foreground">The date range is not valid.</p>}
      {rangeValid && load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Vehicle Profitability…</p>}
      {rangeValid && load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {rangeValid && load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: VehicleProfitReport }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{report.from} through {report.through}, Eastern Time.</p>
      {report.depositsExcludedCents ? <p className="text-sm text-muted-foreground">Deposits excluded: {formatCents(report.depositsExcludedCents)}</p> : null}
      <AdminTableScroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {["Vehicle", "Revenue", "Expenses", "Maintenance", "Net", "Days Rented", "Days Available", "Utilization", "Revenue Per Rented Day"].map((head) => (
                <th key={head} className="py-2 pr-3 font-medium">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => <VehicleRow key={row.vehicleId} row={row} />)}
          </tbody>
        </table>
      </AdminTableScroll>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Unattributed Payments</h2>
        {report.unattributed.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
          <AdminTableScroll>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {["Paid", "Status", "Type", "Amount", "Payments"].map((head) => (
                    <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.unattributed.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="py-2 pr-3">{row.paidDate ?? "—"}</td>
                    <td className="py-2 pr-3">{row.status}</td>
                    <td className="py-2 pr-3">{row.type}</td>
                    <td className="py-2 pr-3">{formatCents(row.amountCents) || "—"}</td>
                    <td className="py-2 pr-3"><Link to="/admin" search={{ tab: "payments" }} className="underline">Payments</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Missing Cost Sources</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {report.missingCostSources.map((source) => <li key={source}>{source}</li>)}
        </ul>
      </section>
    </div>
  );
}

function VehicleRow({ row }: { row: VehicleProfitRow }) {
  const perDay = row.daysRented === 0 ? "No Rented Days" : formatCents(row.revenuePerRentedDayCents) || "—";
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">{row.label}</td>
      <td className="py-2 pr-3">{formatCents(row.revenueCents) || "—"}</td>
      <td className="py-2 pr-3">{formatCents(row.expenseCents) || "—"}</td>
      <td className="py-2 pr-3">{formatCents(row.maintenanceCents) || "—"}</td>
      <td className="py-2 pr-3">{formatCents(row.netCents) || "—"}</td>
      <td className="py-2 pr-3">{row.daysRented ?? "—"}</td>
      <td className="py-2 pr-3">{row.daysAvailable ?? "—"}</td>
      <td className="py-2 pr-3">{formatUtilization(row.utilizationPercent) || "—"}</td>
      <td className="py-2 pr-3">{perDay}</td>
    </tr>
  );
}

function downloadCsv(report: VehicleProfitReport) {
  const blob = new Blob([vehicleProfitToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vehicle-profitability.csv";
  link.click();
  URL.revokeObjectURL(url);
}
