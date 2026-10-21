import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getLeadResponseReport } from "@/lib/lead-response-report.functions";
import {
  LEAD_RESPONSE_REPORT_ENABLED,
  formatResponseHours,
  type LeadResponseReport,
} from "@/lib/lead-response-report";

export function LeadResponseReport() {
  if (LEAD_RESPONSE_REPORT_ENABLED !== true) return null;
  return <LeadResponseReportBody />;
}

function LeadResponseReportBody() {
  const load = useServerFn(getLeadResponseReport);
  const [report, setReport] = useState<LeadResponseReport | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (LEAD_RESPONSE_REPORT_ENABLED !== true) return;
    let current = true;
    setLoading(true);
    setError(false);
    load({ data: {} })
      .then((next) => {
        if (current) setReport(next);
      })
      .catch(() => {
        if (current) {
          setReport(null);
          setError(true);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [load]);

  return (
    <div className="mt-4 rounded-xl border border-border bg-[#F7F7F8] p-3" data-testid="lead-response-report">
      <h3 className="text-sm font-semibold text-[#111114]">Response And Follow-Ups</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Time From Created To First Contact, Uncontacted Leads Older Than 24 Hours, And Follow-Ups Due, By Source.
      </p>
      {loading ? (
        <p role="status" className="py-4 text-sm text-muted-foreground">
          Loading Response Times
        </p>
      ) : error ? (
        <p role="alert" className="py-4 text-sm text-red-700">
          The Response Report Could Not Be Loaded.
        </p>
      ) : report && report.sources.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No Active Leads In This Read.</p>
      ) : (
        report && (
          <>
            {report.truncated && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing The Newest {report.readLimit} Leads. Older Leads Are Not In These Figures.
              </p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Source</th>
                    <th className="py-1 pr-3 font-medium">Median Time To First Contact</th>
                    <th className="py-1 pr-3 font-medium">Uncontacted Over 24 Hours</th>
                    <th className="py-1 font-medium">Follow-Ups Due</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sources.map((source) => (
                    <tr key={source.source} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">{source.source}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatResponseHours(source.medianHours)}</td>
                      <td className="py-2 pr-3 tabular-nums">{source.uncontactedOver24h}</td>
                      <td className="py-2 tabular-nums">{source.followUpsDue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </div>
  );
}
