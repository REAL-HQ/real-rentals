import { fmtDate } from "@/lib/date-format";
import { readContactStatus } from "@/lib/contact-status";
import type { ContactStatusState } from "@/lib/contact-status";
import type { ApprovedNotRentingRow } from "@/lib/booking-funnel";
import { AdminTableScroll } from "./AdminTableScroll";
import { ContactStatusCell } from "./ContactStatusCell";
import { EmptyState } from "./ui";
import { displayPersonName } from "@/lib/display-normalize";

/**
 * Approved applicants who are not on an active rental.
 *
 * Read-only except the Contact Status cell. Mark Contacted is that cell's
 * own save, not a second write and not a message.
 */
export function ApprovedNotRentingList({
  rows,
  populationEmpty,
  failed,
  loading,
  onOpen,
  onContactSaved,
}: {
  rows: ApprovedNotRentingRow[];
  /** The loaded population itself is empty, before search. */
  populationEmpty: boolean;
  failed: boolean;
  loading: boolean;
  onOpen: (id: string) => void;
  onContactSaved: (id: string, state: ContactStatusState) => void;
}) {
  if (failed) {
    return (
      <EmptyState
        title="Could Not Load Approved Drivers"
        hint="Refresh and try again. An empty list is not shown in place of a failed read."
      />
    );
  }
  if (loading) {
    return <div className="px-1 py-10 text-[13px] text-[#9A9AA3]">Loading Approved Drivers…</div>;
  }
  if (populationEmpty) {
    return (
      <EmptyState
        title="No Approved Drivers Waiting To Rent"
        hint="Approved applicants appear here until they have an active rental."
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState title="No Drivers Match This Search" />;
  }

  return (
    <AdminTableScroll className="rounded-lg border border-border bg-white">
      <table className="w-full text-sm" data-approved-not-renting>
        <thead className="bg-[#FAFAFB] text-[11px] text-muted-foreground">
          <tr>
            <th className="text-left font-medium px-3 py-2.5 border-b border-border">Driver</th>
            <th className="text-left font-medium px-3 py-2.5 border-b border-border">Days Since Approval</th>
            <th className="text-left font-medium px-3 py-2.5 border-b border-border">Driver License</th>
            <th className="text-left font-medium px-3 py-2.5 border-b border-border">Insurance</th>
            <th className="text-left font-medium px-3 py-2.5 border-b border-border">Last Contact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const changedAt = readContactStatus(r.contact).state.changedAt;
            return (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className="font-medium text-left hover:underline"
                  >
                    {displayPersonName(r.fullName)}
                  </button>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.daysSinceLabel}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <DocLabel label={r.licenseLabel} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <DocLabel label={r.insuranceLabel} />
                </td>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <ContactStatusCell
                    applicationId={r.id}
                    row={r.contact}
                    showMarkContacted
                    onSaved={(st) => onContactSaved(r.id, st)}
                  />
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {changedAt ? fmtDate(changedAt) : "Not Set"}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </AdminTableScroll>
  );
}

function DocLabel({ label }: { label: string }) {
  const tone =
    label === "Unknown"
      ? "text-[#9A9AA3]"
      : label.includes("Overdue") || label === "Expires Today"
        ? "text-rose-700"
        : "text-foreground";
  return <span className={tone}>{label}</span>;
}
