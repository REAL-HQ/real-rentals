import { displayPersonName } from "@/lib/display-normalize";
import { fmtDate } from "@/lib/date-format";
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

function dayLabel(days: number): string {
  return `${days} ${days === 1 ? "Day" : "Days"}`;
}

/**
 * Owners and Managers: New and Reviewing applications with no activity for
 * three Eastern days. Read only. Nothing here writes, emails, or texts.
 */
export function StalledApplications({
  rows,
  loading,
}: {
  rows: StalledApplicationRow[];
  loading: boolean;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-[#111114]">Stalled Applications</h2>
      {loading ? (
        <p className="px-1 py-8 text-[13px] text-[#9A9AA3]">Loading Stalled Applications…</p>
      ) : rows.length === 0 ? (
        <p className="px-1 py-8 text-[13px] text-[#9A9AA3]">
          No Stalled Applications. New and Reviewing applications appear here after three quiet Eastern days.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Driver</th>
                <th className="px-3 py-2.5 font-medium">Phone</th>
                <th className="px-3 py-2.5 font-medium">Missing</th>
                <th className="px-3 py-2.5 font-medium">Days Stalled</th>
                <th className="px-3 py-2.5 font-medium">Last Contact</th>
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
                  <td className="px-3 py-2.5">
                    {row.gaps.length ? row.gaps.map((gap) => STALLED_GAP_LABEL[gap]).join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2.5" title={row.lastActivityAt}>
                    {dayLabel(row.daysStalled)}
                  </td>
                  <td className="px-3 py-2.5">{row.lastContactOn ? fmtDate(row.lastContactOn) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
