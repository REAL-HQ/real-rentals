import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { applyRenterCredit, listRenterCredits, type RenterCreditRow } from "@/lib/rental-hold.functions";
import { fmtDate } from "@/lib/date-format";

const secondary = "inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

/**
 * Renter credits (a Reservation Fee kept toward the next rental). Staff can apply an
 * Available credit to one of the renter's Reserved or On Hold rentals; it then counts
 * toward week 1 like an attached Reservation Fee. Never a refund, never a deposit.
 */
export function RenterCreditsCard({ canManage, applicationId, rentals }: { canManage: boolean; applicationId?: string | null; rentals: { id: string; applicationId: string | null; label: string }[] }) {
  const load = useServerFn(listRenterCredits);
  const apply = useServerFn(applyRenterCredit);
  const [rows, setRows] = useState<RenterCreditRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(() => {
    load({ data: { applicationId: applicationId ?? null } }).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [load, applicationId]);
  useEffect(refresh, [refresh]);
  const shown = rows.filter((r) => r.status === "available" || r.status === "applied");
  if (!shown.length) return null;
  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white p-3" data-testid="renter-credits">
      <p className="mb-2 text-sm font-semibold text-[#111114]">Renter Credits</p>
      <ul className="space-y-2">
        {shown.map((c) => {
          const targets = rentals.filter((r) => r.applicationId === c.applicationId);
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-credit-status={c.status}>
              <span>
                {c.driverName ?? "Renter"} · ${c.amount.toFixed(2)} · {c.status === "available" ? "Available" : "Applied"} · {fmtDate(c.createdAt)}
                {c.reason ? <span className="block text-xs text-muted-foreground">{c.reason}</span> : null}
              </span>
              {canManage && c.status === "available" && targets.length ? (
                <button
                  type="button"
                  className={secondary}
                  disabled={busy === c.id}
                  onClick={async () => {
                    setBusy(c.id);
                    try {
                      await apply({ data: { creditId: c.id, rentalId: targets[0].id } });
                      toast.success("Credit Applied To Week 1");
                      refresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could Not Apply Credit");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Apply To {targets[0].label}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
