import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBookingConversion } from "@/lib/booking-conversion.functions";
import {
  BOOKING_CONVERSION_ENABLED,
  defaultBookingRange,
  parseBookingRange,
  type BookingConversionReport,
} from "@/lib/booking-conversion";

/**
 * Read-only. The server fn is the only read, and it stays dark until
 * BOOKING_CONVERSION_ENABLED is exactly true.
 */
export function BookingConversionPanel() {
  const load = useServerFn(getBookingConversion);
  const initial = defaultBookingRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const parsed = parseBookingRange(from, to);
  const { data, error, isLoading } = useQuery({
    queryKey: ["booking-conversion", from, to],
    enabled: BOOKING_CONVERSION_ENABLED === true && parsed.ok,
    queryFn: () => load({ data: { from, to } }),
  });

  if (BOOKING_CONVERSION_ENABLED !== true) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">Booking Conversion</h1>
          <p className="text-[13px] text-[#55555E] mt-1">Eastern Time</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] text-[#55555E]">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 block rounded-lg border border-[#E4E4E9] bg-white px-3 py-1.5 text-[13px] text-[#111114]"
            />
          </label>
          <label className="text-[12px] text-[#55555E]">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 block rounded-lg border border-[#E4E4E9] bg-white px-3 py-1.5 text-[13px] text-[#111114]"
            />
          </label>
        </div>
      </div>

      {!parsed.ok ? <p className="text-[13px] text-[#8A1F12]">{parsed.reason}</p> : null}
      {parsed.ok && isLoading ? <p className="text-[13px] text-[#55555E]">Loading Booking Conversion.</p> : null}
      {error ? <p className="text-[13px] text-[#8A1F12]">{error instanceof Error ? error.message : "Could not load booking conversion."}</p> : null}

      {data ? <Report report={data} /> : null}
    </div>
  );
}

function Report({ report }: { report: BookingConversionReport }) {
  if (report.status === "overflow") {
    return (
      <section className="rounded-2xl border border-[#EDEDF0] bg-white p-5">
        <p className="text-[13px] text-[#111114]">
          This range has more than {report.cap.toLocaleString("en-US")} rows, so counts are not shown.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#EDEDF0] bg-white p-5 space-y-4">
      <div>
        <div className="text-[13px] font-semibold text-[#111114]">{report.rangeLabel}</div>
        <p className="text-[12px] text-[#9A9AA3] mt-1 max-w-3xl">{report.note}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] font-semibold text-[#55555E]">
              <th className="py-2 pr-3 font-semibold">Stage</th>
              <th className="py-2 pr-3 font-semibold">Count</th>
              <th className="py-2 pr-3 font-semibold">Conversion</th>
              <th className="py-2 font-semibold">Median Days</th>
            </tr>
          </thead>
          <tbody>
            {report.steps.map((step) => (
              <tr key={step.id} className="border-t border-[#EDEDF0] text-[13px] text-[#111114]">
                <td className="py-2.5 pr-3">{step.label}</td>
                <td className="py-2.5 pr-3 tabular-nums">{step.count.toLocaleString("en-US")}</td>
                <td className="py-2.5 pr-3 tabular-nums">{step.conversion ?? "—"}</td>
                <td className="py-2.5">
                  <div>{step.medianDays ?? step.medianNote ?? "—"}</div>
                  {step.medianDays && step.medianNote ? <div className="text-[11px] text-[#9A9AA3]">{step.medianNote}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
