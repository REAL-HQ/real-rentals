import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getUnbilledTolls } from "@/lib/tolls-unbilled.functions";
import {
  formatUnbilledAge,
  formatUnbilledMoney,
  NOTE_TRUNCATED,
  type UnbilledTollsReport,
  type UnbilledTollsResponse,
} from "@/lib/tolls-unbilled";
import { fmtDate } from "@/lib/date-format";

const truncatedCopy = "This Read Is Truncated";

export function UnbilledTollsSection() {
  const load = useServerFn(getUnbilledTolls);
  const [result, setResult] = useState<UnbilledTollsResponse | null>(null);
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

  return (
    <section className="rounded-xl border border-[#EDEDF0] bg-white">
      <div className="border-b border-[#EDEDF0] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#1C1C1E]">Unbilled Tolls</h2>
        <p className="mt-1 text-xs text-[#55555E]">
          Tolls recorded on a vehicle during an active rental with no charge to the driver. An ambiguous rental match stays Unknown.
        </p>
      </div>
      <div className="px-4 py-3">
        {loading ? <p className="text-sm text-[#55555E]">Loading Unbilled Tolls</p> : null}
        {error ? <p className="text-sm text-[#8A2B22]">Could Not Load Unbilled Tolls</p> : null}
        {!loading && !error && result?.status === "unavailable" ? (
          <p className="text-sm text-[#8A2B22]">{result.reason || "Unbilled Tolls Are Unavailable"}</p>
        ) : null}
        {!loading && !error && result?.status === "ready" ? <ReportView report={result.report} /> : null}
      </div>
    </section>
  );
}

function ReportView({ report }: { report: UnbilledTollsReport }) {
  const notes = report.notes.filter((note) => note !== NOTE_TRUNCATED && note !== truncatedCopy);
  return (
    <div className="space-y-3">
      {report.truncated ? <p className="text-xs text-[#8A5A00]">{truncatedCopy}</p> : null}
      {notes.map((note) => (
        <p key={note} className="text-xs text-[#8A5A00]">
          {note}
        </p>
      ))}
      {report.rows.length === 0 ? <p className="text-sm text-[#55555E]">No Unbilled Tolls</p> : null}
      {report.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#EDEDF0] text-xs text-[#55555E]">
                <th className="py-2 pr-3 font-medium">Vehicle</th>
                <th className="py-2 pr-3 font-medium">Driver</th>
                <th className="py-2 pr-3 font-medium">Occurred</th>
                <th className="py-2 pr-3 font-medium">Age</th>
                <th className="py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.tollId} className="border-b border-[#EDEDF0]">
                  <td className="py-2 pr-3">{row.vehicleLabel}</td>
                  <td className="py-2 pr-3">{row.driverLabel ?? "Unknown"}</td>
                  <td className="py-2 pr-3">{row.occurredOn ? fmtDate(row.occurredOn) : "Unknown"}</td>
                  <td className="py-2 pr-3">{formatUnbilledAge(row.ageDays)}</td>
                  <td className="py-2">{formatUnbilledMoney(row.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-sm font-semibold text-[#1C1C1E]">Total {formatUnbilledMoney(report.totalCents)}</p>
    </div>
  );
}
