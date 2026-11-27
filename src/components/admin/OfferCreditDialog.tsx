import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_RESERVATION_FEE_CREDIT_DAYS } from "@/lib/rental-hold";

const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#111114] px-4 text-sm font-semibold text-white hover:bg-[#2A2A30] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

export function OfferCreditDialog({
  open,
  driverName,
  amount,
  days = DEFAULT_RESERVATION_FEE_CREDIT_DAYS,
  busy = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  driverName: string | null;
  amount: number;
  days?: number;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const money = amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setNote(""); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Offer Credit</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#44444C]">
          {driverName ? `${driverName}'s ` : "This "}{money} stays paid. It becomes a credit toward a future rental, valid {days} days from the payment date.
        </p>
        <label className="mt-3 block text-sm font-medium text-[#111114]" htmlFor="offer-credit-note">Note</label>
        <textarea
          id="offer-credit-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-[#D6D6DB] bg-white px-3 py-2 text-sm text-[#111114]"
        />
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
          <button type="button" className={primary} data-testid="offer-credit-confirm" onClick={() => onConfirm(note)} disabled={busy}>{busy ? "Saving…" : "Offer Credit"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
