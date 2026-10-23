import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SectionCard } from "@/components/admin/ui";
import { Row } from "@/components/admin/VehicleProfileFields";
import { getCloseoutSummary } from "@/lib/closeout-summary.functions";
import { CLOSEOUT_SUMMARY_ENABLED } from "@/lib/closeout-summary";
import { ClipboardCheck } from "lucide-react";

/**
 * Read-only card. Mounted only while CLOSEOUT_SUMMARY_ENABLED is on, and only
 * for an owner or manager looking at an active or ended rental. The server
 * refuses the read when the flag is off.
 */
export function CloseoutSummary({ rentalId }: { rentalId: string }) {
  const load = useServerFn(getCloseoutSummary);
  const query = useQuery({
    queryKey: ["closeout-summary", rentalId],
    queryFn: () => load({ data: { rentalId } }),
    enabled: CLOSEOUT_SUMMARY_ENABLED,
  });
  if (!CLOSEOUT_SUMMARY_ENABLED) return null;

  const summary = query.data && query.data.applies ? query.data : null;

  return (
    <SectionCard title="Closeout Summary" icon={<ClipboardCheck className="w-4 h-4" strokeWidth={1.75} />}>
      {query.isPending && <p className="text-[13px] text-[#55555E]">Loading Closeout Summary</p>}
      {query.isError && (
        <p className="text-[13px] text-[#D03020]">
          {query.error instanceof Error ? query.error.message : "Closeout Summary Could Not Be Loaded"}
        </p>
      )}
      {summary && (
        <div data-testid="closeout-summary">
          <Row label="Weeks Rented" value={summary.weeks} />
          <Row label="Payments Recorded" value={summary.paymentsRecorded} />
          <Row label="Expected" value={summary.expected} />
          <Row label="Unpaid Balance Estimate" value={summary.unpaidBalance} />
          <Row label="Deposit Held" value={summary.depositHeld} />
          <Row label="Open Incidents" value={summary.openIncidents} />
          <Row label="Open Issues" value={summary.openIssues} />
          <Row label="Registration" value={summary.registration} />
          <Row label="Insurance" value={summary.insurance} />
          <Row label="Return Checklist" value={summary.returnChecklist} />
          <p className="pt-3 text-[13px] text-[#111114]" data-testid="closeout-ready">
            {summary.readyLine}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
