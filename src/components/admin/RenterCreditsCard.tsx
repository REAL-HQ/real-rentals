import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { applyRenterCredit, listRenterCredits, offerReservationFeeCreditAction, voidRenterCredit, type RenterCreditRow, type ReservationFeeOffer } from "@/lib/rental-hold.functions";
import { creditCountdownLabel, creditDaysLeft, creditExpired } from "@/lib/forfeited-fee-credit";
import { fmtDate } from "@/lib/date-format";
import { OfferCreditDialog } from "./OfferCreditDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const secondary = "inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";
const primary = "inline-flex h-8 items-center justify-center rounded-md bg-[#111114] px-2.5 text-xs font-semibold text-white hover:bg-[#2A2A30] disabled:opacity-50";

type CreditState = "Available" | "Applied" | "Expired";

function creditState(row: RenterCreditRow, now: Date): CreditState {
  if (row.status === "applied") return "Applied";
  if (row.status === "available" && creditExpired(row.expiresAt, now)) return "Expired";
  return "Available";
}

/**
 * Staff view of renter credits. An offered Reservation Fee stays collected.
 * Staff can offer one, apply an available credit to a Reserved or On Hold
 * rental, or void it with a note. A kept missed-pickup credit uses the same
 * card, including its countdown. An expired credit stays and cannot be applied.
 * Renters do not see this.
 */
export function RenterCreditsCard({
  canManage,
  applicationId,
  rentals,
  showOffer = false,
  driverName = null,
  previewRows,
  now,
}: {
  canManage: boolean;
  applicationId?: string | null;
  rentals: { id: string; applicationId: string | null; label: string }[];
  showOffer?: boolean;
  driverName?: string | null;
  /** Skip the server read. Screenshots and tests pass the rows. */
  previewRows?: RenterCreditRow[];
  now?: Date;
}) {
  const load = useServerFn(listRenterCredits);
  const apply = useServerFn(applyRenterCredit);
  const offer = useServerFn(offerReservationFeeCreditAction);
  const voidCredit = useServerFn(voidRenterCredit);
  const [rows, setRows] = useState<RenterCreditRow[]>(previewRows ?? []);
  const [offerable, setOfferable] = useState<ReservationFeeOffer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidNote, setVoidNote] = useState("");
  const clock = now ?? new Date();
  const refresh = useCallback(() => {
    if (previewRows) return;
    load({ data: { applicationId: applicationId ?? null } }).then((r) => {
      setRows(r.rows);
      setOfferable(r.offer);
    }).catch(() => { setRows([]); setOfferable(null); });
  }, [load, applicationId, previewRows]);
  useEffect(refresh, [refresh]);
  const shown = rows.filter((r) => r.status === "available" || r.status === "applied" || r.status === "expired");
  if (!shown.length && !(showOffer && offerable)) return null;
  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white p-3" data-testid="renter-credits">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#111114]">Renter Credits</p>
        {canManage && showOffer && offerable ? (
          <button type="button" className={primary} data-testid="offer-credit" onClick={() => setOfferOpen(true)}>Offer Credit</button>
        ) : null}
      </div>
      <ul className="space-y-2">
        {shown.map((c) => {
          const state = creditState(c, clock);
          const daysLeft = state === "Available" ? creditDaysLeft(c.expiresAt, clock) : null;
          const urgent = daysLeft != null && daysLeft <= 7;
          const targets = state === "Available" ? rentals.filter((r) => r.applicationId === c.applicationId) : [];
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-credit-status={c.status} data-credit-state={state.toLowerCase()}>
              <span>
                {c.driverName ?? "Renter"} · ${c.amount.toFixed(2)} · {state}
                {state === "Available" ? (
                  <span
                    className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${urgent ? "bg-[#FFF4D6] text-[#8A6A00]" : "bg-[#F4F4F6] text-[#55555E]"}`}
                    data-testid="credit-countdown"
                  >
                    {creditCountdownLabel(c.expiresAt, clock)}
                  </span>
                ) : null}
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
              <span className="flex gap-1">
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
                {canManage && state === "Available" ? (
                  <button type="button" className={secondary} data-testid="void-credit" onClick={() => { setVoidId(c.id); setVoidNote(""); }}>Void</button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {offerable ? (
        <OfferCreditDialog
          open={offerOpen}
          driverName={driverName}
          amount={offerable.amount}
          days={offerable.days}
          busy={busy === "offer"}
          onOpenChange={setOfferOpen}
          onConfirm={async (note) => {
            setBusy("offer");
            try {
              const r = await offer({ data: { paymentId: offerable.paymentId, applicationId: applicationId ?? null, note } });
              toast.success(`Credit Offered · Expires ${fmtDate(r.expiresAt)}`);
              setOfferOpen(false);
              refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could Not Offer Credit");
            } finally {
              setBusy(null);
            }
          }}
        />
      ) : null}
      <Dialog open={voidId !== null} onOpenChange={(next) => { if (!next) setVoidId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Void Credit</DialogTitle></DialogHeader>
          <label className="block text-sm font-medium text-[#111114]" htmlFor="void-credit-note">Note</label>
          <textarea id="void-credit-note" value={voidNote} onChange={(e) => setVoidNote(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-[#D6D6DB] bg-white px-3 py-2 text-sm text-[#111114]" />
          <DialogFooter>
            <button type="button" className={secondary} onClick={() => setVoidId(null)}>Cancel</button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50"
              disabled={busy === "void"}
              onClick={async () => {
                if (!voidId) return;
                setBusy("void");
                try {
                  await voidCredit({ data: { creditId: voidId, reason: voidNote } });
                  toast.success("Credit Voided");
                  setVoidId(null);
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could Not Void Credit");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Void
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
