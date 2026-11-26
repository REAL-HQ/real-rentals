import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { applyRenterCredit, listRenterCredits, type RenterCreditRow } from "@/lib/rental-hold.functions";
import { creditExpired } from "@/lib/forfeited-fee-credit";
import { fmtDate } from "@/lib/date-format";

const secondary = "inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

type CreditState = "Available" | "Applied" | "Expired";

function creditState(row: RenterCreditRow, now: Date): CreditState {
  if (row.status === "applied") return "Applied";
  if (row.status === "available" && creditExpired(row.expiresAt, now)) return "Expired";
  return "Available";
}

/**
 * Renter credits (a Reservation Fee kept toward the next rental). Staff can apply an
 * Available credit to one of the renter's Reserved or On Hold rentals; it then counts
 * toward week 1 like an attached Reservation Fee. An expired credit stays on the card
 * and cannot be applied. Never a refund, never a deposit. Staff only.
 */
export function RenterCreditsCard({
  canManage,
  applicationId,
  rentals,
  previewRows,
  now,
}: {
  canManage: boolean;
  applicationId?: string | null;
  rentals: { id: string; applicationId: string | null; label: string }[];
  /** Skip the server read. Screenshots and tests pass the rows. */
  previewRows?: RenterCreditRow[];
  now?: Date;
}) {
  const load = useServerFn(listRenterCredits);
  const apply = useServerFn(applyRenterCredit);
  const [rows, setRows] = useState<RenterCreditRow[]>(previewRows ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const clock = now ?? new Date();
  const refresh = useCallback(() => {
    if (previewRows) return;
    load({ data: { applicationId: applicationId ?? null } }).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [load, applicationId, previewRows]);
  useEffect(refresh, [refresh]);
  const shown = rows.filter((r) => r.status === "available" || r.status === "applied");
  if (!shown.length) return null;
  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white p-3" data-testid="renter-credits">
      <p className="mb-2 text-sm font-semibold text-[#111114]">Renter Credits</p>
      <ul className="space-y-2">
        {shown.map((c) => {
          const state = creditState(c, clock);
          const targets = state === "Available" ? rentals.filter((r) => r.applicationId === c.applicationId) : [];
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-credit-status={c.status} data-credit-state={state.toLowerCase()}>
              <span>
                {c.driverName ?? "Renter"} · ${c.amount.toFixed(2)} · {state}
                {state === "Expired" ? (
                  <span className="ml-2 inline-flex rounded-full bg-[#F4F4F6] px-2 py-0.5 text-xs font-medium text-[#55555E]">Expired</span>
                ) : null}
                {c.expiresAt ? (
                  <span className="block text-xs text-muted-foreground" data-testid="credit-expiry">
                    {state === "Expired" ? `Expired ${fmtDate(c.expiresAt)}` : `Expires ${fmtDate(c.expiresAt)}`}
                  </span>
                ) : (
                  <span className="block text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
                )}
                {c.reason ? <span className="block text-xs text-muted-foreground">{c.reason}</span> : null}
              </span>
              {canManage && state === "Available" && targets.length ? (
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
