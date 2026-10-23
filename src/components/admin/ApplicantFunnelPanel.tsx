import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getApplicantFunnel } from "@/lib/applicant-funnel.functions";
import { applicantFunnelCsv, FUNNEL_RANGES, type FunnelRange } from "@/lib/applicant-funnel";

/**
 * Read-only. The CSV is built in the browser from the report rows, which
 * carry the application id and no name, email, or phone.
 */
export function ApplicantFunnelPanel() {
  const [days, setDays] = useState<FunnelRange>(30);
  const load = useServerFn(getApplicantFunnel);
  const { data, error, isLoading } = useQuery({
    queryKey: ["applicant-funnel", days],
    queryFn: () => load({ data: { days } }),
  });

  function download() {
    if (!data) return;
    const blob = new Blob([applicantFunnelCsv(data.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `applicant-funnel-${data.days}-days.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">Applicant Funnel</h1>
          <p className="text-[13px] text-[#55555E] mt-1">Eastern Time</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[#E4E4E9] bg-[#FAFAFB] p-1">
          {FUNNEL_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium ${days === range ? "bg-white text-[#111114] shadow-sm" : "text-[#55555E]"}`}
            >
              {range} Days
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <p className="text-[13px] text-[#55555E]">Loading the funnel.</p> : null}
      {error ? (
        <p className="text-[13px] text-[#8A1F12]">{error instanceof Error ? error.message : "Could not load the funnel."}</p>
      ) : null}

      {data ? (
        <section className="rounded-2xl border border-[#EDEDF0] bg-white p-5 space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-[#111114]">{data.rangeLabel}</div>
              <div className="text-[12px] text-[#9A9AA3]">{data.cohort} applications</div>
            </div>
            <button
              type="button"
              onClick={download}
              className="rounded-lg border border-[#E4E4E9] px-3 py-1.5 text-[12px] font-medium text-[#111114]"
            >
              Download CSV
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] font-semibold text-[#55555E]">
                  <th className="py-2 pr-3 font-semibold">Stage</th>
                  <th className="py-2 pr-3 font-semibold">Here</th>
                  <th className="py-2 pr-3 font-semibold">Reached</th>
                  <th className="py-2 font-semibold">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {data.stages.map((stage) => (
                  <tr key={stage.id} className="border-t border-[#EDEDF0] text-[13px] text-[#111114]">
                    <td className="py-2 pr-3">{stage.label}</td>
                    <td className="py-2 pr-3">{stage.here}</td>
                    <td className="py-2 pr-3">{stage.reached == null ? "—" : stage.reached}</td>
                    <td className="py-2">{stage.conversion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-[#55555E]">
            Conversion is the share that reached this stage or a later one, out of those that reached the previous stage. A later status is counted as having passed the earlier stages. Declined is counted on its own.
          </p>

          {data.omittedCount > 0 ? (
            <p className="text-[12px] text-[#55555E]">
              Left Out: {data.omittedCount}
              {data.omittedStatuses.length > 0 ? ` (${data.omittedStatuses.join(", ")})` : ""}
            </p>
          ) : null}

          <div>
            <div className="text-[11px] font-semibold text-[#55555E]">Top Drop-off</div>
            {data.dropOffLabel ? <div className="mt-1 text-[13px] font-medium text-[#111114]">{data.dropOffLabel}</div> : null}
            {data.dropOffDetail ? <p className="mt-1 text-[12px] text-[#55555E]">{data.dropOffDetail}</p> : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-semibold text-[#55555E]">Submitted to Approved</div>
              <p className="mt-1 text-[12px] text-[#55555E]">{data.submittedToApprovedNote}</p>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[#55555E]">Approved to First Rental</div>
              {data.approvedToRental ? <div className="mt-1 text-[13px] font-medium text-[#111114]">{data.approvedToRental}</div> : null}
              {data.approvedToRentalNote ? <p className="mt-1 text-[12px] text-[#55555E]">{data.approvedToRentalNote}</p> : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
