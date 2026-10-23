import { ContactStatusCell } from "@/components/admin/ContactStatusCell";
import { displayPersonName } from "@/lib/display-normalize";
import type { ContactStatusState } from "@/lib/contact-status";
import type { StalledApplicationRow } from "@/lib/stalled-applications.functions";
import { STALLED_GAP_LABEL } from "@/lib/stalled-applications";

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  return phone;
}

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

/**
 * Owners and Managers: applicants who started and then went quiet.
 * Mark Contacted is the existing Contact Status write.
 */
export function StalledApplications({
  rows,
  loading,
  onContactSaved,
}: {
  rows: StalledApplicationRow[];
  loading: boolean;
  onContactSaved: (applicationId: string, state: ContactStatusState) => void;
}) {
  if (loading) {
    return <p className="px-1 py-8 text-[13px] text-[#9A9AA3]">Loading Stalled Applications…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="px-1 py-8 text-[13px] text-[#9A9AA3]">
        No Stalled Applications. Someone appears here after three quiet days with a license, insurance, or identity review still open.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-[#FAFAFB] text-left text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-medium">Driver</th>
            <th className="px-3 py-2.5 font-medium">Phone</th>
            <th className="px-3 py-2.5 font-medium">Missing</th>
            <th className="px-3 py-2.5 font-medium">Days Stalled</th>
            <th className="px-3 py-2.5 font-medium">Contact Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-stalled-application={row.id} className="border-t border-border">
              <td className="px-3 py-2.5 font-medium">{displayPersonName(row.name)}</td>
              <td className="px-3 py-2.5">
                {row.phone ? (
                  <a href={telHref(row.phone)} className="text-[#111114] underline" data-stalled-call>
                    {formatPhone(row.phone)}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5">{row.gaps.map((gap) => STALLED_GAP_LABEL[gap]).join(", ")}</td>
              <td className="px-3 py-2.5" title={row.lastActivityAt}>
                {row.daysStalled} Days
              </td>
              <td className="px-3 py-2.5">
                <ContactStatusCell
                  applicationId={row.id}
                  row={row.contact ?? {}}
                  showMarkContacted
                  onSaved={(state) => onContactSaved(row.id, state)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
