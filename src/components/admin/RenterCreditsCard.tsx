import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { applyRenterCredit, listRenterCredits, offerReservationFeeCreditAction, voidRenterCredit, type RenterCreditRow, type ReservationFeeOffer } from "@/lib/rental-hold.functions";
import { fmtDate } from "@/lib/date-format";
import { OfferCreditDialog } from "./OfferCreditDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const secondary = "inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";
const primary = "inline-flex h-8 items-center justify-center rounded-md bg-[#111114] px-2.5 text-xs font-semibold text-white hover:bg-[#2A2A30] disabled:opacity-50";

function statusLabel(status: RenterCreditRow["status"]): string {
  if (status === "applied") return "Applied";
  if (status === "expired") return "Expired";
  if (status === "void") return "Void";
  return "Available";
}

/**
 * Staff view of renter credits. An offered Reservation Fee stays collected;
 * this card can offer one, apply an available credit to a Reserved or On Hold
 * rental, or void it with a note. Renters do not see this.
 */
export function RenterCreditsCard({ canManage, applicationId, rentals, showOffer = false, driverName = null }: { canManage: boolean; applicationId?: string | null; rentals: { id: string; applicationId: string | null; label: string }[]; showOffer?: boolean; driverName?: string | null }) {
  const load = useServerFn(listRenterCredits);
  const apply = useServerFn(applyRenterCredit);
  const offer = useServerFn(offerReservationFeeCreditAction);
  const voidCredit = useServerFn(voidRenterCredit);
  const [rows, setRows] = useState<RenterCreditRow[]>([]);
  const [offerable, setOfferable] = useState<ReservationFeeOffer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidNote, setVoidNote] = useState("");
  const refresh = useCallback(() => {
    load({ data: { applicationId: applicationId ?? null } }).then((r) => {
      setRows(r.rows);
      setOfferable(r.offer);
    }).catch(() => { setRows([]); setOfferable(null); });
  }, [load, applicationId]);
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
          const targets = rentals.filter((r) => r.applicationId === c.applicationId);
          const when = c.expiresAt ? fmtDate(c.expiresAt) : null;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-credit-status={c.status}>
              <span>
                {c.driverName ?? "Renter"} · ${c.amount.toFixed(2)} · {statusLabel(c.status)}
                {when ? ` · ${c.status === "available" ? "Expires " : ""}${when}` : ` · ${fmtDate(c.createdAt)}`}
                {c.reason ? <span className="block text-xs text-muted-foreground">{c.reason}</span> : null}
              </span>
              <span className="flex gap-1">
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
                {canManage && c.status === "available" ? (
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
