import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getRevenueForecast } from "@/lib/revenue-forecast.functions";
import { IDLE_POTENTIAL_LABEL, PROJECTION_LABEL, revenueForecastToCsv, type RevenueForecastReport } from "@/lib/revenue-forecast";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * The amounts are a projection, not money collected.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: RevenueForecastReport };

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function RevenueForecastPanel() {
  const read = useServerFn(getRevenueForecast);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Revenue Forecast could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Revenue Forecast</h1>
          <p className="mt-1 text-sm font-medium text-[#111114]">{PROJECTION_LABEL}</p>
          <p className="mt-1 text-sm text-muted-foreground">Expected rental income for the next 4 weeks, Monday through Sunday, Eastern Time. A rental stops after its end date. This screen does not collect a payment.</p>
        </div>
        {load.kind === "ready" && load.report.warnings.length === 0 && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Revenue Forecast…</p>}
      {load.kind === "disabled" && <p className="text-sm text-muted-foreground">Revenue Forecast Is Off.</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: RevenueForecastReport }) {
  if (report.warnings.length > 0) {
    return (
      <div className="space-y-2">
        {report.warnings.map((warning) => <p key={warning} className="text-sm text-[#D03020]">{warning}</p>)}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <AdminTableScroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {["Week", "Dates", "Projected Income"].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}
            </tr>
          </thead>
          <tbody>
            {report.weeks.map((week, index) => (
              <tr key={week.from} className="border-b">
                <td className="py-2 pr-3">Week {index + 1}</td>
                <td className="py-2 pr-3">{week.label}</td>
                <td className="py-2">{money(week.cents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3 font-medium" colSpan={2}>Total</td>
              <td className="py-2 font-medium">{money(report.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </AdminTableScroll>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">By Vehicle</h2>
        {report.vehicles.length === 0 ? <p className="text-sm text-muted-foreground">No Active Rentals In The Projection.</p> : (
          <AdminTableScroll>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {["Vehicle", "Week 1", "Week 2", "Week 3", "Week 4", "Total"].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.vehicles.map((vehicle) => (
                  <tr key={vehicle.vehicleId} className="border-b">
                    <td className="py-2 pr-3">
                      <Link to="/admin" search={{ tab: "vehicles", id: vehicle.vehicleId }} className="underline">{vehicle.label}</Link>
                    </td>
                    {vehicle.weekCents.map((cents, index) => <td key={index} className="py-2 pr-3">{money(cents)}</td>)}
                    <td className="py-2">{money(vehicle.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
        )}
      </section>
      <section className="space-y-1">
        <h2 className="text-lg font-semibold">Idle Vehicles</h2>
        <p className="text-sm text-muted-foreground">{report.idleCount} idle {report.idleCount === 1 ? "vehicle" : "vehicles"}. Idle means Available or no active rental, and not archived, sold, or retired.</p>
        <p className="text-sm text-[#111114]">{IDLE_POTENTIAL_LABEL}: {money(report.idlePotentialCents)}. This is not included in the projected income.</p>
        {report.idleRateNotSet > 0 && (
          <p className="text-sm text-muted-foreground">{report.idleRateNotSet} idle {report.idleRateNotSet === 1 ? "vehicle has" : "vehicles have"} no listed rate, so {report.idleRateNotSet === 1 ? "it is" : "they are"} left out of that potential.</p>
        )}
      </section>
      <p className="text-sm text-muted-foreground">
        {report.excludedMissingDue} active {report.excludedMissingDue === 1 ? "rental is" : "rentals are"} excluded because Next Payment Due is missing.
      </p>
    </div>
  );
}

function downloadCsv(report: RevenueForecastReport) {
  const blob = new Blob([revenueForecastToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "revenue-forecast.csv";
  link.click();
  URL.revokeObjectURL(url);
}
