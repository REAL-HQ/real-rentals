import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { listExpiringRenterDocuments, type ExpiringRenterDocuments } from "@/lib/document-expiry.functions";
import { daysLeftLabel, type ExpiringRenter, type ExpiryScope } from "@/lib/document-expiry";
import { displayPersonName } from "@/lib/display-normalize";

/** Count chip for Overview. Loads through the manager server read. */
export function DocumentsExpiringChip() {
  const load = useServerFn(listExpiringRenterDocuments);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    load({ data: undefined })
      .then((result) => {
        if (live) {
          const rows = result.defaultScope === "renting" ? result.renting : result.approved;
          setCount(rows.length);
        }
      })
      .catch(() => {
        if (live) setCount(null);
      });
    return () => {
      live = false;
    };
    // The server function identity is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Link
      to="/admin"
      search={{ tab: "drivers", filter: "documents-expiring" }}
      data-documents-expiring-chip
      className="inline-flex items-center gap-2 rounded-full border border-[#EDEDF0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#111114] hover:border-[#D03020]/40"
    >
      Documents Expiring
      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#111114] px-1.5 text-[10px] font-semibold text-white">
        {count == null ? "…" : count}
      </span>
    </Link>
  );
}

function cellText(renter: ExpiringRenter, kind: ExpiringRenter["cells"][number]["kind"]): string {
  const cell = renter.cells.find((c) => c.kind === kind);
  if (!cell) return "Unknown";
  return daysLeftLabel(cell.daysLeft, cell.status);
}

/** Manager list. Sorted by the caller. Each name opens that driver. */
export function DocumentsExpiringList({
  result,
  failed,
  scope,
  onScope,
  onOpen,
}: {
  result: ExpiringRenterDocuments | null;
  failed: boolean;
  scope: ExpiryScope;
  onScope: (scope: ExpiryScope) => void;
  onOpen: (applicationId: string) => void;
}) {
  if (failed) {
    return (
      <p className="rounded-lg border border-border bg-white px-4 py-6 text-sm text-[#55555E]">
        Could Not Load Documents Expiring
      </p>
    );
  }
  if (!result) {
    return <p className="px-1 py-6 text-sm text-[#77777F]">Loading Documents Expiring…</p>;
  }
  const soonest = (renter: ExpiringRenter) =>
    renter.soonestDays == null ? "Unknown" : daysLeftLabel(renter.soonestDays, renter.soonestDays < 0 ? "expired" : "expiring");
  const rows = scope === "renting" ? result.renting : result.approved;
  const empty =
    scope === "renting" ? "No Active Rentals With Documents Expiring" : "No Approved Drivers With Documents Expiring";
  return (
    <div className="rounded-lg border border-border bg-white" data-documents-expiring-list>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-[#111114]">Documents Expiring</h2>
        <p className="mt-0.5 text-[12px] text-[#55555E]">
          Driver license, insurance, or rideshare platform documents that are expired, expire within {result.windowDays}{" "}
          days, or have no date on file. Days are Eastern Time. Missing dates show as Unknown.
        </p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Documents Expiring Scope">
          {(
            [
              ["renting", "Renting Now", result.renting.length],
              ["approved", "Approved Drivers", result.approved.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={scope === key}
              onClick={() => onScope(key)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${scope === key ? "bg-black text-white" : "border border-[#EDEDF0] bg-white text-[#111114]"}`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[#55555E]">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Driver</th>
                <th className="px-3 py-2.5 font-medium">Driver License</th>
                <th className="px-3 py-2.5 font-medium">Insurance</th>
                <th className="px-3 py-2.5 font-medium">Rideshare Platform</th>
                <th className="px-3 py-2.5 font-medium">Days Left (ET)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((renter) => (
                <tr key={renter.applicationId} className="border-t border-border">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpen(renter.applicationId)}
                      className="font-medium text-[#111114] underline-offset-2 hover:text-[#D03020] hover:underline"
                    >
                      {displayPersonName(renter.fullName)}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">{cellText(renter, "license")}</td>
                  <td className="px-3 py-2.5">{cellText(renter, "insurance")}</td>
                  <td className="px-3 py-2.5">{cellText(renter, "rideshare")}</td>
                  <td className="px-3 py-2.5 font-medium">{soonest(renter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
