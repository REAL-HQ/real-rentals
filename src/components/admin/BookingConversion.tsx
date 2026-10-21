import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getBookingConversion } from "@/lib/booking-conversion.functions";
import {
  BOOKING_CONVERSION_ENABLED,
  type BookingConversionReport,
  type ConversionRates,
} from "@/lib/booking-conversion";
import { AdminTableScroll } from "./AdminTableScroll";

function percent(rate: number | null): string {
  if (rate == null) return "—";
  return `${rate.toFixed(1)}%`;
}

function RateCells({ rates }: { rates: ConversionRates }) {
  return (
    <>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{percent(rates.toApplication)}</td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{percent(rates.toApproved)}</td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{percent(rates.toFirstRental)}</td>
    </>
  );
}

/**
 * Counts and conversion by source and week, on the Bookings and Leads screens.
 * Renders nothing and does not call the server while the flag is off.
 * Read only.
 */
export function BookingConversion({ canView }: { canView: boolean }) {
  if (BOOKING_CONVERSION_ENABLED !== true || canView !== true) return null;
  return <ConversionBody />;
}

function ConversionBody() {
  const load = useServerFn(getBookingConversion);
  const [report, setReport] = useState<BookingConversionReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    load()
      .then((result) => {
        if (live) setReport(result);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [load]);

  return (
    <section className="mb-4 rounded-xl border border-border bg-white p-4" aria-labelledby="booking-conversion-title">
      <h2 id="booking-conversion-title" className="text-sm font-medium text-[#111114]">
        Booking Conversion
      </h2>
      <p className="mt-1 text-[13px] text-[#55555E]">
        Leads And Booking Requests Through Application, Approved, And First Rental. Last 8 Eastern Weeks. Weeks Start Monday (Eastern).
      </p>
      {error ? (
        <p className="px-1 py-6 text-[13px] text-[#9A9AA3]">Booking Conversion Could Not Be Loaded.</p>
      ) : !report ? (
        <p className="px-1 py-6 text-[13px] text-[#9A9AA3]">Loading Booking Conversion…</p>
      ) : (
        <>
          {report.truncated && (
            <p className="mt-3 text-[13px] text-[#9A9AA3]">
              Counts Are Capped At {report.cap.toLocaleString()} Rows.
            </p>
          )}
          {report.rows.length === 0 ? (
            <p className="px-1 py-6 text-[13px] text-[#9A9AA3]">No Leads Or Booking Requests In The Last 8 Weeks.</p>
          ) : (
        <AdminTableScroll className="mt-3 rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Week</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Leads / Requests</th>
                <th className="px-3 py-2 font-medium">Applications</th>
                <th className="px-3 py-2 font-medium">Approved</th>
                <th className="px-3 py-2 font-medium">First Rental</th>
                <th className="px-3 py-2 font-medium">To Application</th>
                <th className="px-3 py-2 font-medium">To Approved</th>
                <th className="px-3 py-2 font-medium">To First Rental</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={`${row.weekStart}:${row.source}`} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{row.weekLabel}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.source}</td>
                  <td className="px-3 py-2 tabular-nums">{row.counts.leads}</td>
                  <td className="px-3 py-2 tabular-nums">{row.counts.applications}</td>
                  <td className="px-3 py-2 tabular-nums">{row.counts.approved}</td>
                  <td className="px-3 py-2 tabular-nums">{row.counts.firstRentals}</td>
                  <RateCells rates={row.rates} />
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2">All Sources</td>
                <td className="px-3 py-2 tabular-nums">{report.totals.leads}</td>
                <td className="px-3 py-2 tabular-nums">{report.totals.applications}</td>
                <td className="px-3 py-2 tabular-nums">{report.totals.approved}</td>
                <td className="px-3 py-2 tabular-nums">{report.totals.firstRentals}</td>
                <RateCells rates={report.rates} />
              </tr>
            </tbody>
          </table>
        </AdminTableScroll>
          )}
        </>
      )}
    </section>
  );
}
